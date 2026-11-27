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

A equipe cria, cancela ou encerra sorteios pelo painel. O formulário pede nome, descrição, valor da participação, limite de pessoas e valor do produto. Digite **0** no limite para deixar as vagas ilimitadas e **0** no valor da participação para deixar a entrada gratuita. Os valores são informativos.

Os membros podem entrar e sair enquanto o sorteio está aberto. Quando a equipe clica em **Sortear ganhador**, o bot escolhe uma pessoa aleatoriamente entre as inscritas e mostra o resultado no painel.

Por padrão, sorteios e inscrições são gravados em `giveaways_data.json`. Em uma hospedagem com sistema de arquivos temporário, configure `GIVEAWAYS_DATA_FILE` com o caminho do arquivo em um volume persistente.
