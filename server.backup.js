import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import * as fs from "fs";
import dotenv from "dotenv";
import twilio from "twilio";

dotenv.config();

-
// --- DEMO MODE (sem usar a API) ---
// Aceita on/true/1/yes em qualquer caixa
const IS_DEMO = ['on', 'true', '1', 'yes'].includes(
  String(process.env.DEMO_MODE).toLowerCase()
);

const WHATS_HUMANO = process.env.WHATS_HUMANO || 'https://wa.me/5532991413852';

function demoReply(text) {
  const t = (text || '').trim().toLowerCase();

  if (!t || /^(menu|oi|olá|ola|hello|hi)$/.test(t)) {
    return 'Olá! 😊 Sou a assistente da Clínica Sorriso Nova Era.\n1) Agendar consulta\n2) Convênios/valores\n3) Orientações pré/pós\n4) Falar com atendente';
  }
  if (t === '1' || /agendar/.test(t)) {
    return 'Perfeito! ✨ Prefere manhã ou tarde?';
  }
  if (/manhã|manha/.test(t)) {
    return 'Opções manhã: Terça 09:30 (Dra. Ana) | Quinta 10:15 (Dr. Paulo). Responda 1 ou 2.';
  }
  if (/tarde/.test(t)) {
    return 'Opções tarde: Quarta 15:00 (Dra. Ana) | Sexta 16:30 (Dr. Paulo). Responda 1 ou 2.';
  }
  if (t === '2' || /(convênios?|convenios?|valores)/.test(t)) {
    return 'Aceitamos: OdontoPrev, Amil Dental e Unimed Odonto. Quer agendar uma avaliação pelo convênio?';
  }
  if (t === '3' || /(orienta[cç][aã]o|pré|pre|pós|pos)/.test(t)) {
    return 'Pré-limpeza: alimente-se leve 1–2h antes, traga documento/carteirinha e chegue 10 min antes. Deseja agendar?';
  }
  if (t === '4' || /(atendente|humano|recep[cç][aã]o|falar)/.test(t)) {
    return `Claro! Vou te encaminhar: ${WHATS_HUMANO}`;
  }
  return 'Não entendi. Digite "menu" ou escolha: 1) Agendar  2) Convênios/valores  3) Orientações  4) Atendente';
}


const PORT = process.env.PORT || 3000;

// OpenAI
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const SYSTEM_PROMPT_PATH = process.env.SYSTEM_PROMPT_PATH || "./prompt.txt";

// WhatsApp (Meta Cloud API)
const META_TOKEN = process.env.META_WHATS_TOKEN;           // Permanent access token
const META_PHONE_ID = process.env.META_PHONE_NUMBER_ID;    // Phone Number ID
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;   // Your verification string



const app = express();
// Middlewares – precisam vir antes das rotas
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.get("/health", (req, res) => res.status(200).send("ok"));

// Webhook verification (GET)
app.get("/meta/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === META_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Webhook receiver (POST)
app.post("/meta/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;
    if (!messages || messages.length === 0) {
      return res.sendStatus(200);
    }
    const msg = messages[0];
    const from = msg.from;
    const type = msg.type;

    let userText = "";
    if (type === "text") {
      userText = msg.text?.body || "";
    } else if (type === "interactive") {
      userText = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "";
    } else {
      userText = "(mensagem não textual)";
    }

    const botReply = await callOpenAI(userText);
    for (const chunk of chunkText(botReply, 900)) {
      await sendWhatsText(from, chunk);
    }
  } catch (e) {
    console.error("Webhook error", e?.response?.data || e);
  }
  res.sendStatus(200);
});

function chunkText(text, size=900) {
  const parts = [];
  let i = 0;
  while (i < text.length) {
    parts.push(text.slice(i, i + size));
    i += size;
  }
  return parts;
}

async function callOpenAI(userText) {
  const { OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const systemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, "utf-8");

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.3,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText }
    ]
  });

  const out = completion.choices?.[0]?.message?.content || "Desculpe, tive um problema para responder agora.";
  if (/atendente|humano|recepção/i.test(userText)) {
    return out + `\n\nPara falar com um atendente: ${WHATS_HUMANO}`;
  }
  return out;
}

async function sendWhatsText(to, body) {
  const url = `https://graph.facebook.com/v20.0/${META_PHONE_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    text: { body }
  };
  const headers = {
    Authorization: `Bearer ${META_TOKEN}`,
    "Content-Type": "application/json"
  };
  const resp = await axios.post(url, payload, { headers });
  return resp.data;
}

// === Twilio WhatsApp webhook (DEMO) ===
app.post('/twilio/whatsapp', async (req, res) => {
  const body = req.body || {};
  const text = (body.Body || '').trim();
  // const from = body.From || '';
  // const to   = body.To   || '';

  try {
    const twiml = new twilio.twiml.MessagingResponse();

    // Em DEMO, respondemos localmente, sem custo de API
    const reply = IS_DEMO ? demoReply(text) : `Eco: ${text}`;


    twiml.message(reply);
    res.type('text/xml').status(200).send(twiml.toString());
  } catch (err) {
    console.error('Erro em /twilio/whatsapp (DEMO):', err);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('Ops, deu um probleminha. Tente outra mensagem ou fale com um atendente.');
    res.type('text/xml').status(200).send(twiml.toString());
  }
});




app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`• Health: http://localhost:${PORT}/health`);
  console.log(`• Webhook (Meta): POST /meta/webhook  | GET /meta/webhook (verification)`);
});
