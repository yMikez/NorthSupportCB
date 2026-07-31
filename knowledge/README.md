# Base de conhecimento do atendente de suporte

Esta pasta é o cérebro do chat de suporte. São arquivos `.md` comuns — você não
precisa programar nada para deixar o atendente mais inteligente.

## Como funciona

A cada conversa o sistema monta o "manual" do atendente nesta ordem:

1. **`_common.md`** — sempre carregado. Políticas que valem para tudo: tom de
   voz, triagem de humor, playbook de retenção, fluxo de reembolso, o que nunca
   fazer.
2. **`_platform-<plataforma>.md`** — opcional. Notas específicas de uma
   plataforma de venda (`_platform-jvzoo.md`, `_platform-digistore24.md`,
   `_platform-buygoods.md`).
3. **`<vendor>.md`** — conhecimento do produto (dosagem, prazos, FAQ).

Tudo isso vira o system prompt do Claude, com prompt caching ligado. Editar um
arquivo invalida o cache só na próxima conversa — é seguro editar a qualquer
momento.

## Adicionar um produto novo

1. Crie `knowledge/<vendor>.md` (minúsculo, sem espaços). Use o
   [burnthermo.md](burnthermo.md) como molde.
2. Diga ao sistema qual produto usa esse arquivo, na variável
   `PRODUCT_VENDOR_MAP` do `.env`:

   ```env
   PRODUCT_VENDOR_MAP=digistore24:534210=burnthermo,jvzoo:99812=glycopulse
   ```

   O formato é `plataforma:idDoProduto=nomeDoArquivo`, separado por vírgula.
   Omita `plataforma:` para valer em todas.

3. Pronto. Em desenvolvimento o arquivo é recarregado sozinho; em produção com
   Docker a pasta é montada como volume, então também não precisa rebuild.

**Se você não mapear**, o sistema tenta adivinhar pelo título do produto:
"Thermo Burn" procura `thermoburn.md`. Funciona, mas é frágil — prefira o mapa.

**Se não achar arquivo nenhum**, o atendente usa só o `_common.md`. Ele continua
educado e seguindo a política, mas não sabe nada do produto.

## Conhecimento diferente por plataforma

Se o mesmo produto tem regra diferente em cada plataforma (janela de reembolso,
por exemplo), crie `<plataforma>-<vendor>.md`:

```
knowledge/
  burnthermo.md              ← usado por padrão
  jvzoo-burnthermo.md        ← usado quando a venda veio do JVZoo
```

O arquivo específico da plataforma substitui o genérico (não soma).

## Descobrir qual arquivo está sendo usado

Logado no `/admin`, abra:

```
/api/diagnose?orderId=<número do pedido>
```

A resposta mostra em qual plataforma o pedido foi encontrado e qual arquivo de
conhecimento o sistema espera carregar.

## Dicas de escrita

- Tópicos curtos. O modelo lê melhor bullets do que parágrafos densos.
- Para FAQs use: `**"pergunta do cliente"** → resposta curta.`
- Frases prontas funcionam melhor do que conceitos abstratos — o atendente copia.
- **Nunca coloque informação que você não tem certeza.** Tudo aqui é tratado
  como verdade absoluta e vai ser repetido para o cliente.
- Não repita nos dois lugares: o que vale para todo produto fica no
  `_common.md`, o que é do produto fica no arquivo do produto.
- Mire em 150–250 linhas por produto. O conteúdo vai junto em cada mensagem.
