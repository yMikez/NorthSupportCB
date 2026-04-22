# Base de conhecimento do atendente de suporte

Esta pasta alimenta o chat de suporte com IA.

## Como funciona

1. `_common.md` é **sempre** carregado — coloque aqui políticas que valem para todos os vendors (tom de voz, política geral de reembolso, endereço de devolução, etc.).
2. A cada conversa, o sistema identifica o **vendor** do pedido pelo receipt e carrega o arquivo correspondente (ex.: `neurompro.md`).
3. O conteúdo concatenado vira o system prompt do Claude, com prompt caching ativado — cada atualização do arquivo invalida o cache só na próxima conversa, então é seguro editar a qualquer momento.

## Adicionar um novo vendor

1. Crie um arquivo `nome-do-vendor.md` nesta pasta (nome em minúsculas, idêntico ao nickname ClickBank).
2. Adicione o nickname em `CLICKBANK_VENDORS` no `.env.local`.
3. Pronto — a próxima conversa com esse vendor já usa o arquivo.

Se não existir arquivo para o vendor, o atendente usa apenas `_common.md`.

## Dicas de escrita

- Escreva em tópicos curtos. O modelo lê melhor bullets do que parágrafos densos.
- Use **negrito** para destacar respostas prontas a dúvidas frequentes.
- Nunca coloque informação que você não tem certeza — o atendente vai tratar tudo aqui como verdade absoluta.
- Para FAQs, use o formato: `**"Pergunta do cliente"** → resposta curta.`
