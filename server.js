// server.js — Data Tech | OdontoBot DEMO (Twilio Sandbox) — CommonJS

require('dotenv').config();

const express = require('express');
const twilio  = require('twilio');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// Twilio envia application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ===== Config DEMO/Handoff =====
const WHATS_HUMANO   = process.env.WHATS_HUMANO || 'https://wa.me/5599999999999';
const DEMO_MODE_RAW  = String(process.env.DEMO_MODE || 'true').toLowerCase();
const IS_DEMO        = ['on','true','1','yes'].includes(DEMO_MODE_RAW);

// ===== Health =====
app.get('/health', (_req, res) => res.status(200).send('ok'));

// ===== Memória em RAM (stateful por usuário) =====
const sessions = new Map(); // key => { step, period, slot, name }

function getKeyFromBody(b) {
  if (b.WaId) return `wa:${b.WaId}`;        // ID estável do WhatsApp dado pela Twilio
  if (b.From) return String(b.From);        // fallback
  return 'anon';
}
function getSession(key) {
  if (!sessions.has(key)) sessions.set(key, { step: 'menu' });
  return sessions.get(key);
}
function resetSession(key) { sessions.set(key, { step: 'menu' }); }

function saveLead({ key, from, name, period, slot }) {
  try {
    const path   = './leads.csv';
    const header = 'timestamp,key,from,name,period,slot,channel\n';
    const line   = `${new Date().toISOString()},${JSON.stringify(key)},${JSON.stringify(from)},"${name}",${period},"${slot}",twilio-sandbox\n`;
    if (!fs.existsSync(path)) fs.writeFileSync(path, header, 'utf8');
    fs.appendFileSync(path, line, 'utf8');
  } catch (e) {
    console.error('Erro ao salvar lead:', e);
  }
}

// ===== Textos e slots de exemplo (DEMO) =====
const MENU_TXT =
  'Olá! 😊 Sou a assistente da Clínica Sorriso Nova Era.\n' +
  '1) Agendar consulta\n' +
  '2) Convênios/valores\n' +
  '3) Orientações pré/pós\n' +
  '4) Falar com atendente';

const CONVENIOS_TXT =
  'Convênios aceitos (DEMO): OdontoPrev, Amil Dental, Unimed Odonto.\n' +
  'Cobertura típica: avaliação, limpeza, restaurações simples.\n' +
  'Quer marcar uma *avaliação* pelo convênio? Responda *sim* ou *não*.';

const SLOTS = {
  'manhã': ['Terça 09:30 – Dra. Ana', 'Quinta 10:15 – Dr. Paulo'],
  'tarde': ['Quarta 15:00 – Dra. Ana', 'Sexta 16:30 – Dr. Paulo'],
};

// ===== Webhook Twilio WhatsApp (DEMO sem OpenAI) =====
app.post('/twilio/whatsapp', async (req, res) => {
  const b       = req.body || {};
  const textRaw = String(b.Body ?? '').trim();
  const text    = textRaw.toLowerCase();
  const key     = getKeyFromBody(b);        // chave estável de sessão
  const from    = b.From || '';

  const MessagingResponse = twilio.twiml.MessagingResponse;
  const twiml = new MessagingResponse();

  const s = getSession(key);
  console.log(`[DEMO] key=${key} step=${s.step} text="${textRaw}"`);

  // ---- atalhos universais ----
  if (/^menu$|^0$/.test(text)) {
    resetSession(key);
    twiml.message(MENU_TXT);
    return res.type('text/xml').status(200).send(twiml.toString());
  }
  if (/atendente|humano/i.test(textRaw)) {
    twiml.message(`Claro! Vou te encaminhar: ${WHATS_HUMANO}`);
    return res.type('text/xml').status(200).send(twiml.toString());
  }

  // ---- estado inicial / menu ----
  if (s.step === 'menu') {
    if (['1', 'agendar', 'agenda'].includes(text)) {
      s.step = 'ask_period';
      twiml.message('Perfeito! ✨ Prefere *manhã* ou *tarde*?');
      return res.type('text/xml').status(200).send(twiml.toString());
    }
    if (['2', 'convenios', 'convênios', 'convênio', 'convênio/valores', 'convênios/valores'].includes(text)) {
      s.step = 'conv_yesno';
      twiml.message(CONVENIOS_TXT);
      return res.type('text/xml').status(200).send(twiml.toString());
    }
    if (['3', 'pré', 'pre', 'pre/pós', 'pré/pós', 'orientações', 'orientacoes'].includes(text)) {
      twiml.message('Pré-limpeza: escove normalmente, evite café/vinho 3h antes, traga documento e carteirinha. Quer agendar? Digite *1* (Agendar) ou *menu*.');
      return res.type('text/xml').status(200).send(twiml.toString());
    }
    if (['4', 'atendente'].includes(text)) {
      twiml.message(`Claro! Vou te encaminhar: ${WHATS_HUMANO}`);
      return res.type('text/xml').status(200).send(twiml.toString());
    }
    // fallback do menu
    twiml.message(MENU_TXT);
    return res.type('text/xml').status(200).send(twiml.toString());
  }

  // ---- fluxo vindo de Convênios ----
  if (s.step === 'conv_yesno') {
    if (['sim', 's', 'quero', 'ok', 'yes'].includes(text)) {
      s.step = 'ask_period';
      twiml.message('Ótimo! Para avaliação pelo convênio, prefere *manhã* ou *tarde*?');
      return res.type('text/xml').status(200).send(twiml.toString());
    }
    if (['nao', 'não', 'n', 'no'].includes(text)) {
      resetSession(key);
      twiml.message('Sem problemas! Quando quiser, digite *menu* para começar de novo.');
      return res.type('text/xml').status(200).send(twiml.toString());
    }
    twiml.message('Responda *sim* para agendar avaliação pelo convênio, ou *não* para voltar.');
    return res.type('text/xml').status(200).send(twiml.toString());
  }

  // ---- escolher período ----
  if (s.step === 'ask_period') {
    const sayManha = /manh(a|ã)/.test(text);
    const sayTarde = /tarde/.test(text);
    if (!sayManha && !sayTarde) {
      twiml.message('Para continuar, responda *manhã* ou *tarde* 😉');
      return res.type('text/xml').status(200).send(twiml.toString());
    }
    s.period = sayManha ? 'manhã' : 'tarde';
    s.step   = 'pick_slot';
    const opts = SLOTS[s.period];
    twiml.message(
      `Opções (${s.period}):\n` +
      `1) ${opts[0]}\n` +
      `2) ${opts[1]}\n` +
      `Responda *1* ou *2*.`
    );
    return res.type('text/xml').status(200).send(twiml.toString());
  }

  // ---- escolher horário ----
  if (s.step === 'pick_slot') {
    if (!['1', '2'].includes(text)) {
      twiml.message('Responda *1* ou *2* para escolher o horário.');
      return res.type('text/xml').status(200).send(twiml.toString());
    }
    const idx = text === '1' ? 0 : 1;
    s.slot = SLOTS[s.period][idx];
    s.step = 'ask_name';
    twiml.message('Perfeito! Para finalizar, me diga seu *nome completo*.');
    return res.type('text/xml').status(200).send(twiml.toString());
  }

  // ---- capturar nome ----
  if (s.step === 'ask_name') {
    if (text.length < 2) {
      twiml.message('Pode enviar seu *nome completo*, por favor?');
      return res.type('text/xml').status(200).send(twiml.toString());
    }
    s.name = textRaw; // preserva capitalização
    s.step = 'confirm';
    twiml.message(
      '✅ *Resumo da avaliação (DEMO)*\n' +
      `• Nome: ${s.name}\n` +
      `• Período: ${s.period}\n` +
      `• Horário: ${s.slot}\n\n` +
      'Responda: *confirmar* | *reagendar* | *cancelar*'
    );
    return res.type('text/xml').status(200).send(twiml.toString());
  }

  // ---- confirmar / reagendar / cancelar ----
  if (s.step === 'confirm') {
    if (text === 'confirmar') {
      saveLead({ key, from, name: s.name, period: s.period, slot: s.slot });
      resetSession(key);
      twiml.message('🎉 Confirmado (DEMO)! Vamos enviar as instruções de pré-consulta. Se precisar, digite *menu*.');
      return res.type('text/xml').status(200).send(twiml.toString());
    }
    if (text === 'reagendar') {
      s.step = 'ask_period';
      twiml.message('Sem problemas! Prefere *manhã* ou *tarde*?');
      return res.type('text/xml').status(200).send(twiml.toString());
    }
    if (text === 'cancelar') {
      resetSession(key);
      twiml.message('Ok, agenda cancelada (DEMO). Se quiser começar de novo, digite *menu*.');
      return res.type('text/xml').status(200).send(twiml.toString());
    }
    twiml.message('Responda *confirmar*, *reagendar* ou *cancelar* 🙂');
    return res.type('text/xml').status(200).send(twiml.toString());
  }

  // ---- fallback geral ----
  twiml.message('Não entendi 🙃. Digite *menu* para as opções.');
  return res.type('text/xml').status(200).send(twiml.toString());
});

// ===== Listen =====
app.listen(PORT, () => {
  console.log('✅ Server running on port', PORT);
  console.log(`• Health: http://localhost:${PORT}/health`);
  console.log('• Webhook (Twilio Sandbox WhatsApp): POST /twilio/whatsapp');
});
