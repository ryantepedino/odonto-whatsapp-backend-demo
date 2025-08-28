// server.js - DEMO estável para Render
const express = require('express');
const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ===== Config DEMO (edite se quiser) =====
const CLINIC_NAME = process.env.CLINIC_NAME || 'Clínica DEMO';
const CONVENIOS = (process.env.CONVENIOS || 'OdontoPrev, Amil Dental, Unimed').split(',').map(s=>s.trim());
const ATENDENTE_LINK = process.env.ATENDENTE_LINK || ''; // ex: https://wa.me/5524999999999

// Sessão simples em memória (suficiente para DEMO no Render)
const session = new Map();     // key = whatsapp:+55..., value = {state, pending}

// Util: gera TwiML seguro
function twiml(text){
  const safe = String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<Response><Message>${safe}</Message></Response>`;
}

// ===== Health =====
app.get('/health', (req, res) => res.status(200).send('OK'));

// ===== WhatsApp Webhook (Twilio) =====
app.post('/twilio/whatsapp', (req, res) => {
  const from = (req.body.From || '').toLowerCase();   // "whatsapp:+5524..."
  const body = (req.body.Body || '').trim();
  const msg  = body.toLowerCase();

  const s = session.get(from) || { state: 'menu', pending: null };

  // Helpers
  const menu = () =>
`👋 Olá! Eu sou o Agente Odonto da ${CLINIC_NAME}.
Escolha uma opção:
1) Agendar consulta
2) Convênios aceitos
3) Orientações Pré/Pós
4) Falar com atendente`;

  const askAgendar = () =>
`🗓️ Para agendar, me diga: procedimento + dia + horário.
Exemplo: "limpeza amanhã às 15h".`;

  // Roteamento por estado
  let reply;

  // Fluxo handoff: pediu atendente → coleta nome
  if (s.state === 'coletando_nome') {
    const nome = body.replace(/\s+/g,' ').trim();
    reply = ATENDENTE_LINK
      ? `Obrigada, ${nome}! 👩‍💼 Vou chamar o atendente agora: ${ATENDENTE_LINK}`
      : `Obrigada, ${nome}! 👩‍💼 Vou avisar o atendente para te chamar em instantes.`;
    s.state = 'menu';
  }
  // Fluxo de confirmação de agendamento
  else if (s.state === 'confirmando' && (msg.startsWith('1') || msg.includes('sim'))) {
    const p = s.pending || {};
    const resumo = `✅ Agendamento (DEMO) confirmado:
- Procedimento: ${p.procedimento || '—'}
- Data/Hora: ${p.dataHora || '—'}
- Paciente: ${from.replace('whatsapp:','')}`;
    reply = `${resumo}\n\nObrigado! Posso ajudar em algo mais?\n${menu()}`;
    s.state = 'menu'; s.pending = null;
  }
  else if (s.state === 'confirmando' && (msg.startsWith('2') || msg.includes('alterar data'))) {
    reply = 'Sem problemas! Informe novamente a data (ex.: "amanhã", "10/09").';
    s.state = 'aguardando_dados';
  }
  else if (s.state === 'confirmando' && (msg.startsWith('3') || msg.includes('alterar horário') || msg.includes('alterar horario'))) {
    reply = 'Claro! Informe novamente o horário (ex.: "15h", "09:30").';
    s.state = 'aguardando_dados';
  }
  // Coleta de dados livres para agendar
  else if (s.state === 'aguardando_dados') {
    const proc = (body.match(/(limpeza|avaliação|avaliacao|canal|extração|extracao|implante|restauração|restauracao|clareamento)/i)||[])[0] || 'procedimento';
    // data simples
    let dataTxt = 'data a combinar';
    if (msg.includes('amanhã') || msg.includes('amanha')) dataTxt = 'amanhã';
    else if (/\b\d{1,2}\/\d{1,2}\b/.test(msg)) dataTxt = msg.match(/\b\d{1,2}\/\d{1,2}\b/)[0];

    // horário simples
    let horaTxt = (msg.match(/\b\d{1,2}[:h]\d{2}\b/)||msg.match(/\b\d{1,2}h\b/)||[])[0] || 'horário a combinar';
    horaTxt = horaTxt.replace('h',':00');

    const dataHora = `${dataTxt} ${horaTxt}`.trim();

    s.pending = { procedimento: proc, dataHora };
    s.state = 'confirmando';
    reply = `Resumo (DEMO): ${proc}, ${dataHora}.
Confirma? (1 Sim / 2 Alterar data / 3 Alterar horário)`;
  }
  // Entradas diretas que caem no fluxo de agendar
  else if (msg === '1' || msg.includes('agendar')) {
    reply = askAgendar();
    s.state = 'aguardando_dados';
  }
  else if (msg === '2' || msg.includes('convênio') || msg.includes('convenio')) {
    reply = `🏥 Convênios aceitos: ${CONVENIOS.join(', ')}.
Quer (1) agendar ou (4) falar com atendente?`;
    s.state = 'menu';
  }
  else if (msg === '3' || msg.includes('pré') || msg.includes('pós') || msg.includes('pre') || msg.includes('pos')) {
    reply = `📋 Pré/Pós (resumo):
• Extração: repouso 24h, compressa gelada.
• Limpeza: evitar café 2h.
• Implante: seguir medicação prescrita.
(Conteúdo completo no site da clínica.)
${menu()}`;
    s.state = 'menu';
  }
  else if (msg === '4' || msg.includes('atendente')) {
    reply = '👩‍💼 Posso te passar para um atendente humano. Qual seu nome?';
    s.state = 'coletando_nome';
  }
  else {
    reply = menu();
    s.state = 'menu';
  }

  session.set(from, s);
  res.type('text/xml').status(200).send(twiml(reply));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Servidor rodando na porta ' + PORT));
