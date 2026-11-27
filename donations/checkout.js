'use strict';

const $ = id => document.getElementById(id);
const form = $('donation');
const status = $('status');
const session = location.hash.slice(1);
const storageKey = 'spiker-pix:' + session;
const api = document.querySelector('meta[name="checkout-api"]').content;
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
let payment;

function setStatus(text) { status.textContent = text; }

async function call(action, body) {
  const response = await fetch(api + '/api/doacoes/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir esta solicitação.');
  return data;
}

function show(data) {
  payment = data;
  form.hidden = true;
  $('payment').hidden = false;
  $('total').textContent = 'Pix de ' + brl.format(data.amount / 100);
  $('qr').src = data.qr;
  $('pix-code').value = data.copyPaste;
  const expiry = data.expiresAt ? new Date(data.expiresAt).toLocaleString('pt-BR') : null;
  $('expiry').textContent = expiry ? 'Use o QR Code até ' + expiry + '.' : 'Pague pelo aplicativo do seu banco.';
  setStatus('Aguardando pagamento. Após pagar, clique em Verificar pagamento.');
}

if (!/^[A-Za-z0-9_-]{43}$/.test(session)) {
  setStatus('Abra a página pelo botão Doar via Pix no canal de doações do SpikerHak.');
} else {
  form.hidden = false;
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey));
    if (saved?.receipt && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(saved.qr)) show(saved);
  } catch {}
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const value = $('amount').value.trim();
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(value)) {
    setStatus('Digite um valor em reais, como 2,52.');
    return;
  }
  const [whole, decimal = ''] = value.split(/[,.]/);
  const amount = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  const button = form.querySelector('button');
  button.disabled = true;
  setStatus('Gerando o Pix…');
  try {
    const data = await call('pix', { token: session, amount });
    try { sessionStorage.setItem(storageKey, JSON.stringify(data)); } catch {}
    show(data);
  } catch (error) {
    setStatus(error.message);
  } finally {
    button.disabled = false;
  }
});

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(payment.copyPaste);
    setStatus('Código Pix copiado.');
  } catch {
    $('pix-code').select();
    setStatus('Selecione e copie o código Pix.');
  }
});

$('check').addEventListener('click', async () => {
  const button = $('check');
  button.disabled = true;
  setStatus('Consultando a PromissePay…');
  try {
    const data = await call('status', { receipt: payment.receipt });
    if (data.status === 'paid' && data.donorRoleGranted === false) {
      setStatus('Pix confirmado. O cargo ainda está pendente no Discord. Tente verificar de novo em instantes.');
    } else if (data.status === 'paid') {
      $('payment').hidden = true;
      setStatus(data.donorRoleGranted
        ? 'Pix confirmado. O cargo Doador foi liberado no Discord!'
        : 'Pagamento confirmado. Obrigado por apoiar o SpikerHak!');
    } else if (data.status === 'expired') {
      $('payment').hidden = true;
      setStatus('Este Pix expirou ou foi cancelado. Gere outro pelo Discord.');
    } else {
      setStatus('A Promisse ainda está aguardando o pagamento.');
    }
  } catch (error) {
    setStatus(error.message);
  } finally {
    button.disabled = false;
  }
});
