# 🤖 SpikerBot — Discord Bot SpikerHak

Bot oficial da comunidade **SpikerHak** focado em Inteligência Artificial, Provedores Gratuitos, Automações e Verificação OCR.

## 🚀 Funcionalidades
- **Verificação Automática por OCR (Tesseract.js):** Validação de prints de inscrição no canal do YouTube [@spikerhakofc](https://www.youtube.com/@spikerhakofc).
- **Sistema de Tickets Interativo:** Abertura de suporte individual (`suporte-001`), encerramento exclusivo para Staff e avaliação por estrelas na DM.
- **Sorteios personalizados:** Use `/sorteio` para publicar um painel de participação no canal atual.
- **Log de Auditoria:** Registro de avaliações e membros verificados no canal de moderação.
- **Servidor HTTP Embutido:** Health check para manter o bot rodando 24/7 no Render (Web Service).

## 🛠️ Tecnologias
- [Node.js](https://nodejs.org/) (v18+)
- [Discord.js](https://discord.js.org/) (v14)
- [Tesseract.js](https://tesseract.projectnaptha.com/) (v7)

## Sorteios

A equipe cria, cancela ou encerra sorteios pelo painel. O formulário pede nome, descrição, limite de pessoas e valor do produto. Digite **0** no limite para deixar as vagas ilimitadas. A participação é sempre gratuita e o valor do produto é apenas informativo.

Na última etapa, clique em **Definir duração** e informe um tempo, como `30m`, `2h`, `1h 30m` ou `3d`. O painel mostra o horário de encerramento e os membros podem entrar e sair até lá. Ao atingir o prazo, o bot fecha as inscrições e sorteia uma pessoa entre as inscritas. A equipe também pode antecipar o sorteio com **Sortear ganhador**.

Use `/sorte-test` para passar pelas mesmas etapas e publicar um painel marcado como **[TESTE]** apenas no canal **🤖・comandos-admin**.

Por padrão, sorteios e inscrições são gravados em `giveaways_data.json`. Em uma hospedagem com sistema de arquivos temporário, configure `GIVEAWAYS_DATA_FILE` com o caminho do arquivo em um volume persistente.

## Doações via Pix

O painel no canal **💸・doações** abre um link privado para o checkout do SpikerHak. O servidor aceita doações a partir de **R$ 2,52**, consulta a taxa na PromissePay, cria o QR Code e consulta o estado do pagamento na própria API do gateway. A doação é voluntária e independente dos sorteios.

Configure a credencial da PromissePay com os escopos `payments.create` e `payments.read` como `PROMISSE_API_KEY` no ambiente ou no arquivo secreto do Render com esse nome. O checkout usa a URL HTTPS configurada no serviço por `RENDER_EXTERNAL_URL` ou `KEEP_ALIVE_URL`.
