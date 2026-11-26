# 🤖 SpikerBot — Discord Bot SpikerHak

Bot oficial da comunidade **SpikerHak** focado em Inteligência Artificial, Provedores Gratuitos, Automações e Verificação OCR.

## 🚀 Funcionalidades
- **Verificação automática de inscrição:** Aceita imagens e quadros de vídeos que mostrem o canal do YouTube [@spikerhakofc](https://www.youtube.com/@spikerhakofc) junto ao status “Inscrito” ou ao sino de inscrição.
- **Sistema de Tickets Interativo:** Abertura de suporte individual (`suporte-001`), encerramento exclusivo para Staff e avaliação por estrelas na DM.
- **Log de Auditoria:** Registro de avaliações e membros verificados no canal de moderação.
- **Servidor HTTP Embutido:** Health check para manter o bot rodando 24/7 no Render (Web Service).

## 🛠️ Tecnologias
- [Node.js](https://nodejs.org/) (v18+)
- [Discord.js](https://discord.js.org/) (v14)
- [Tesseract.js](https://tesseract.projectnaptha.com/) (v7)

No canal de verificação, cada anexo pode ter até 25 MB. Vídeos MP4, MOV e WebM podem ter até dois minutos. A instalação tenta baixar o FFmpeg pela dependência opcional `ffmpeg-static`. Se o ambiente já tiver FFmpeg, ele também pode ser encontrado no `PATH` ou configurado pela variável `FFMPEG_PATH`.
