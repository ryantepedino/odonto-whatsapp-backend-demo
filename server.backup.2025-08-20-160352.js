'use strict';

/**
 * Odonto WhatsApp Backend (DEMO sem OpenAI)
 * Compatível com Node.js (CommonJS)
 */
const fs = require('fs');
const express = require('express');
const dotenv = require('dotenv');
const twilio = require('twilio');

dotenv.config();

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// --- Config App/Env
const PORT = process.env.PORT || 3000;
const WHATS_HUMANO =
  process.env.WHATS_HUMANO || 'https://wa.me/5532991413852';

// Aceita on/true/1/yes (qualquer caixa) para o modo DEMO
const IS_DEMO = ['on', 'true', '1', 'yes'].includes(
  String(process.env.DEMO_MODE || 'on').toLowerCase()
);

// --- Função de resposta DEMO (sem custo de API)
function demoReplyText(input) {
  const t = String(input || '').trim().toLowerCase();

  if (!t || ['oi', 'olá', 'ola', 'hi', 'hello', 'menu'].includes(t)) {
    return [
      'Olá! 😊 Sou a assistente da Clínica Sorriso Nova Era.',
      '1) Agendar consulta',
      '2) Convênios/valores',
      '3) Orientações pré/pós',
      '4) Falar com atendente'
    ].join('\n');
  }

  if (t === '1' || t.includes('agendar') || t.includes('agenda')) {
    return 'Perfeito! ✨ Prefere **manhã** ou **tarde**?';
  }

  if (t.includes('manhã') || t.includes('manha')) {
    return [
      'Opções (manhã):',
      '• Terça 09:30 – Dra. Ana',
      '• Quinta 10:15 – Dr. Paulo',
      'Responda 1 (Ter 09:30) ou 2 (Qui 10:15).'
    ].join('\n');
  }

  if (t.includes('tarde')) {
    return [
      'Opções (tarde):',
      '• Quarta 15:00 – Dra. Ana',
      '• Sexta 16:30 – Dr. Paulo',
      'Responda 1 (Qua 15:00) ou 2 (Sex 16:30).'
    ].join('\n');
  }

  if (t === '2' || t.includes('convênio') || t.includes('convenio') || t.includes('valores')) {
    return [
      'Convênios aceitos (DEMO): OdontoPrev, Amil Dental, Unimed Odonto.',
      'Cobertura típica: avaliação, limpeza, restaurações simples.',
      'Quer marcar uma **avaliação** pelo convênio?'
    ].join('\n');
  }

  if (t === '3' || t.includes('orienta') || t.includes('pré') || t.includes('pre') || t.includes('pós') || t.includes('pos')) {
    return 'Pré-limpeza: escove normalmente, evite café/vinho 3h antes, traga documento e carteirinha. Quer agendar?';
  }

  if (t === '4' || t.includes('atendente') || t.includes('humano') || t.includes('recepção') || t.includes('recepcao')) {
    return `Claro! 👩‍⚕️ Vou te encaminhar: ${WHATS_HUMANO}`;
  }

  return 'Não entendi 🙃. Digite "menu" ou escolha: 1) Agendar • 2) Convênios • 3) Pré/Pós • 4) Atendente';
}

// --- Healthcheck
app.get('/health', (req, res) => res.status(200).send('ok'));

// --- Webhook Meta (placeholders p/ manter compatibilidade com seus prints)
app.get('/meta/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === (process.env.META_VERIFY_TOKEN || 'odonto_verify_123')) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post('/meta/webhook', (req, res) => {
  console.log('[Meta] webhook recebido');
  return res.sendStatus(200);
});

// --- Webhook do WhatsApp (Twilio Sandbox)
app.post('/twilio/whatsapp', async (req, res) => {
  try {
    const body = req.body || {};
    const text = String(body.Body || '').trim();
    const from = (body.From || '').replace('whatsapp:', ''); // <- ESSENCIAL

    const MessagingResponse = twilio.twiml.MessagingResponse;
    const twiml = new MessagingResponse();

    const reply = IS_DEMO ? demoReplyText(text, from) : `Eco: ${text}`;
    twiml.message(reply);
    res.type('text/xml').status(200).send(twiml.toString());

  } catch (err) {
    console.error('Erro em /twilio/whatsapp:', err);
    const MessagingResponse = twilio.twiml.MessagingResponse;
    const twiml = new MessagingResponse();
    twiml.message('Ops, tive um problema temporário. Tente novamente em instantes 🙏');
    res.type('text/xml').status(200).send(twiml.toString());
  }
});

// --- Start
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`• Health: http://localhost:${PORT}/health`);
  console.log('• Webhook (Meta): POST /meta/webhook  | GET /meta/webhook (verification)');
});

// ====== DEMO stateful (memória em RAM) + leads.csv ======
const sessions = new Map(); // from => { step, period, slot, name }

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
  'tarde': ['Quarta 15:00 – Dra. Ana', 'Sexta 16:30 – Dr. Paulo']
};

function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, { step: 'menu' });
  return sessions.get(id);
}

function resetSession(id) {
  sessions.set(id, { step: 'menu' });
}

function saveLead({ from, name, period, slot }) {
  const path = './leads.csv';
  const header = 'timestamp,from,name,period,slot,channel\n';
  const line = `${new Date().toISOString()},${from},"${name}",${period},"${slot}",twilio-sandbox\n`;
  if (!fs.existsSync(path)) fs.writeFileSync(path, header, 'utf8');
  fs.appendFileSync(path, line, 'utf8');
}

// === Twilio WhatsApp webhook (DEMO) ===
app.post('/twilio/whatsapp', async (req, res) => {
  const b = req.body || {};
  const textRaw = (b.Body || '').trim();
  const text = textRaw.toLowerCase();
  const from = b.From || 'desconhecido';

  const twiml = new twilio.twiml.MessagingResponse();

  // atalho para atendente
  if (/atendente|humano/i.test(textRaw)) {
    twiml.message(`Claro! Vou te encaminhar: ${WHATS_HUMANO}`);
    return res.type('text/xml').status(200).send(twiml.toString());
  }

  // volta ao menu
  if (text === 'menu' || text === '0') {
    resetSession(from);
    twiml.message(MENU_TXT);
    return res.type('text/xml').status(200).send(twiml.toString());
  }

  const s = getSession(from);

  // estado inicial / menu
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

  // fluxo vindo dos convênios
  if (s.step === 'conv_yesno') {
    if (['sim', 's', 'quero', 'ok'].includes(text)) {
      s.step = 'ask_period';
      twiml.message('Ótimo! Para avaliação pelo convênio, prefere *manhã* ou *tarde*?');
      return res.type('text/xml').status(200).send(twiml.toString());
    }
    if (['nao', 'não', 'n'].includes(text)) {
      resetSession(from);
      twiml.message('Sem problemas! Quando quiser, digite *menu* para começar de novo.');
      return res.type('text/xml').status(200).send(twiml.toString());
    }
    twiml.message('Responda *sim* para agendar avaliação pelo convênio, ou *não* para voltar.');
    return res.type('text/xml').status(200).send(twiml.toString());
  }

  // escolher período
  if (s.step === 'ask_period') {
    const sayManha = /manh(a|ã)/.test(text);
    const sayTarde = /tarde/.test(text);
    if (!sayManha && !sayTarde) {
      twiml.message('Para continuar, responda *manhã* ou *tarde* 😉');
      return res.type('text/xml').status(200).send(twiml.toString());
    }
    s.period = sayManha ? 'manhã' : 'tarde';
    s.step = 'pick_slot';
    const opts = SLOTS[s.period];
    twiml.message(
      `Opções (${s.period}):\n` +
      `1) ${opts[0]}\n` +
      `2) ${opts[1]}\n` +
      `Responda *1* ou *2*.`
    );
    return res.type('text/xml').status(200).send(twiml.toString());
  }

  // escolher horário
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

  // capturar nome
  if (s.step === 'ask_name') {
    if (text.length < 2) {
      twiml.message('Pode enviar seu *nome completo*, por favor?');
      return res.type('text/xml').status(200).send(twiml.toString());
    }
    s.name = textRaw; // mantém capitalização original
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

  // confirmar/reagendar/cancelar
  if (s.step === 'confirm') {
    if (text === 'confirmar') {
      saveLead({ from, name: s.name, period: s.period, slot: s.slot });
      resetSession(from);
      twiml.message('🎉 Confirmado (DEMO)! Vamos enviar as instruções de pré-consulta. Se precisar, digite *menu*.');
      return res.type('text/xml').status(200).send(twiml.toString());
    }
    if (text === 'reagendar') {
      s.step = 'ask_period';
      twiml.message('Sem problemas! Prefere *manhã* ou *tarde*?');
      return res.type('text/xml').status(200).send(twiml.toString());
    }
    if (text === 'cancelar') {
      resetSession(from);
      twiml.message('Ok, agenda cancelada (DEMO). Se quiser começar de novo, digite *menu*.');
      return res.type('text/xml').status(200).send(twiml.toString());
    }
    twiml.message('Responda *confirmar*, *reagendar* ou *cancelar* 🙂');
    return res.type('text/xml').status(200).send(twiml.toString());
  }

  // fallback geral
  twiml.message('Não entendi 🙃. Digite *menu* para as opções.');
  return res.type('text/xml').status(200).send(twiml.toString());
});
