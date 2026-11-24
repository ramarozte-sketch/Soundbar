# Soundbar Q990B

App Android para controlar a soundbar **Samsung HW-Q990B** através da API SmartThings.

## Funções
- **Comando:** ligar/desligar, volume (botões, barra e teclas físicas do telemóvel), silenciar, entrada (HDMI 1/2, ótico, Wi‑Fi, Bluetooth, TV eARC), modo de som (Padrão, Surround, Game Pro, Adaptativo), música a tocar com anterior/pausa/seguinte.
- **Som:** modo noturno, realce de voz, Active Voice Amplifier, reforço de graves, SpaceFit Sound, nível do subwoofer (−12 a +6), presets do equalizador e bandas (experimental).
- **Colunas:** nível de cada canal (central, laterais, wide, topo frente, traseiras, topo traseiras) e posição das colunas traseiras.
- **Definições:** volume máximo, intervalo de atualização, registo de pedidos.

## Primeira utilização
1. Em https://account.smartthings.com/tokens gera um token com todas as permissões de **Devices** e **Apps**.
2. Cola-o na app e toca em **Ligar (ligação permanente)**.
3. Entra com a conta Samsung na janela que abre e autoriza. A partir daí a app renova o acesso sozinha (abre-a pelo menos uma vez a cada 30 dias).

## Compilar
Cada push para `main` compila o APK no GitHub Actions e publica-o em **Releases**.
