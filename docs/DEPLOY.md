# Deploy — SupportChat

Guia passo-a-passo para subir o SupportChat na VPS Hostinger com:
- Docker Compose
- Postgres dedicado
- Caddy (HTTPS automático via Let's Encrypt)
- Domínio: `support.thenorthscales.com`

---

## 0. Pré-requisitos na VPS

- Docker + Docker Compose (a Hostinger já fornece via "Gerenciador Docker").
- Acesso SSH à VPS (`ssh root@72.62.104.202`).
- Portas **80 e 443** livres.

## 1. DNS

No painel do domínio `thenorthscales.com`, cria um registro **A**:

| Nome | Tipo | Conteúdo | TTL |
|---|---|---|---|
| `support` | A | `72.62.104.202` | 14400 |

Aguarda a propagação (2–15 min). Para conferir:

```bash
dig support.thenorthscales.com +short
# deve responder 72.62.104.202
```

## 2. Parar o projeto "backend" antigo

Na Hostinger → **Gerenciador Docker** → projeto `backend` → **Gerenciar** → **Stop** (NÃO "Remove"; só parar).

Isso libera a porta 80 para o Caddy. Os containers do cloaker ficam parados mas preservados — dá pra religar depois quando quiseres.

## 3. Subir os arquivos do SupportChat pra VPS

Na máquina local, dentro da pasta do projeto, sincroniza com a VPS. Uma das opções:

**Opção A — via `git` (mais limpo):**

```bash
# Na VPS:
mkdir -p /opt/supportchat
cd /opt/supportchat
git clone <url-do-teu-repo> .
```

**Opção B — via `scp` (se não tens git remoto):**

Na máquina local:

```bash
# Enviar tudo menos node_modules/.next/etc:
rsync -av --exclude node_modules --exclude .next --exclude .git \
  ./ root@72.62.104.202:/opt/supportchat/
```

## 4. Configurar o `.env` de produção na VPS

```bash
ssh root@72.62.104.202
cd /opt/supportchat
cp .env.production.example .env
nano .env
```

Preenche:

```env
POSTGRES_USER=supportchat
POSTGRES_PASSWORD=<gerar com: openssl rand -base64 32>
POSTGRES_DB=supportchat

CLICKBANK_API_KEY_READ=API-...
CLICKBANK_API_KEY_WRITE=API-...
CLICKBANK_VENDORS=neurompro,burnthermo,maxvitaliz,glycopulse

ANTHROPIC_API_KEY=sk-ant-...

ADMIN_SECRET=<gerar com: openssl rand -base64 24>

MOCK_MODE=false
NEXT_PUBLIC_MOCK_MODE=false
```

Ctrl+O, Enter, Ctrl+X.

## 5. Subir os containers

```bash
cd /opt/supportchat
docker compose up -d --build
```

Na primeira vez demora 3–5 min (build do Next + pull do postgres/caddy). Depois:

```bash
docker compose ps
# Todos devem estar "Up" e (healthy)
```

## 6. Verificar

- **App:** https://support.thenorthscales.com — deve abrir a tela do cliente
- **Admin:** https://support.thenorthscales.com/admin/login
- **Certificado HTTPS:** automático (Caddy emite via Let's Encrypt). Primeira request pode demorar 5–10s.

## 7. Comandos úteis no dia-a-dia

```bash
# Ver logs ao vivo
docker compose logs -f app
docker compose logs -f caddy

# Restart só da app (sem reiniciar banco)
docker compose restart app

# Atualizar código (após git pull ou novo rsync)
docker compose up -d --build app

# Acessar o Postgres
docker compose exec postgres psql -U supportchat -d supportchat

# Backup do banco
docker compose exec postgres pg_dump -U supportchat supportchat > backup-$(date +%F).sql

# Restaurar
cat backup-2026-04-22.sql | docker compose exec -T postgres psql -U supportchat -d supportchat
```

## 8. Backup automático (opcional, recomendado)

Cria `/etc/cron.daily/supportchat-backup`:

```bash
#!/bin/sh
cd /opt/supportchat
mkdir -p backups
docker compose exec -T postgres pg_dump -U supportchat supportchat \
  | gzip > backups/backup-$(date +%F).sql.gz
# Manter só últimos 14 dias
find backups -name 'backup-*.sql.gz' -mtime +14 -delete
```

```bash
chmod +x /etc/cron.daily/supportchat-backup
```

## 9. Arquivos de conhecimento (knowledge/)

A pasta `knowledge/` é copiada para dentro do container durante o build. Se quiseres atualizar os arquivos sem refazer o build completo, duas opções:

**A — Rebuild (simples, ~60s):**
```bash
docker compose up -d --build app
```

**B — Montar como volume (edita e reinicia):**

Edita `docker-compose.yml`, na seção `app`, adiciona:

```yaml
    volumes:
      - ./knowledge:/app/knowledge:ro
```

Depois `docker compose up -d app` e qualquer mudança nos `.md` é lida na próxima conversa (o loader em `lib/knowledge.ts` já faz invalidação por mtime).

## Troubleshooting

- **Certificado HTTPS não emite:** o Caddy precisa acesso público nas portas 80 e 443. Verifica firewall da Hostinger e confirma que o DNS já propagou.
- **"migrate deploy failed" nos logs:** o entrypoint loga mas segue — geralmente é porque o banco ainda não aceita conexões. Aguarda 10s e checa de novo com `docker compose logs app`.
- **Porta 80 ocupada:** outra app/container está nela. Confirma com `docker ps | grep :80` e para o que estiver usando.
