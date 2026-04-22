# Auto-deploy via GitHub Actions

Cada push na branch `main` dispara um deploy automático na VPS:
1. SSH na VPS
2. `git pull`
3. `docker compose up -d --build app` (rebuild só da app; postgres e caddy continuam rodando)
4. `docker image prune -f` (limpa imagens antigas pra não lotar disco)
5. Health check HTTP

Workflow em [.github/workflows/deploy.yml](../.github/workflows/deploy.yml).

---

## Setup — primeira vez

### 1. Gerar par de chaves SSH dedicado ao GitHub Actions

**Na tua máquina local** (não reusa a chave pessoal — se vazar tu isolas só o Actions):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_actions_supportchat -N "" -C "github-actions-supportchat"
```

Isso gera dois arquivos:
- `~/.ssh/github_actions_supportchat` — **chave privada** (vai nos secrets do GitHub)
- `~/.ssh/github_actions_supportchat.pub` — **chave pública** (vai na VPS)

### 2. Autorizar a chave pública na VPS

```bash
ssh-copy-id -i ~/.ssh/github_actions_supportchat.pub root@72.62.104.202

# ou manualmente:
cat ~/.ssh/github_actions_supportchat.pub | ssh root@72.62.104.202 'cat >> ~/.ssh/authorized_keys'
```

Teste o acesso:
```bash
ssh -i ~/.ssh/github_actions_supportchat root@72.62.104.202 'echo ok'
# deve imprimir "ok" sem pedir senha
```

### 3. Adicionar secrets no GitHub

No repositório → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

Cria estes 5 secrets:

| Nome | Valor |
|---|---|
| `SSH_HOST` | `72.62.104.202` |
| `SSH_USER` | `root` |
| `SSH_PRIVATE_KEY` | Conteúdo COMPLETO de `~/.ssh/github_actions_supportchat` (incluindo `-----BEGIN/END`) |
| `PROJECT_PATH` | `/opt/supportchat` |
| `APP_URL` | `https://support.thenorthscales.com` |

### 4. Testar

Faz qualquer mudança boba, push pra main, e acompanha na aba **Actions** do GitHub. O deploy deve rodar em ~1–3 min dependendo se precisa rebuildar ou não.

---

## Commands úteis

- **Disparar manualmente** (sem precisar de push): Actions → Deploy to VPS → **Run workflow**.
- **Ver último deploy:** Actions → histórico da última execução → logs de cada step.
- **Desabilitar temporariamente:** Actions → Deploy to VPS → `···` → **Disable workflow**.

---

## Limitações & quando o auto-deploy NÃO roda

O workflow só faz `git pull && rebuild`. Ele NÃO:

- Aplica novos secrets/env do `.env` (tu tens que editar manualmente na VPS)
- Reinicia `postgres` ou `caddy` (só `app`) — se tu mudares o `Caddyfile` ou `docker-compose.yml`, precisa SSH e rodar `docker compose up -d` manualmente
- Roda migrations de forma explícita — o entrypoint da app já roda `prisma migrate deploy` no boot, então migrations novas são aplicadas automaticamente no restart

Se tu mudares `.env` ou `docker-compose.yml`:
```bash
ssh root@72.62.104.202
cd /opt/supportchat
nano .env  # ou edita o compose
docker compose up -d
```
