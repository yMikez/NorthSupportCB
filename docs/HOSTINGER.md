# Deploy na Hostinger

## Antes de tudo: precisa ser VPS

A Hostinger vende três coisas parecidas. Só uma serve:

| Plano | Serve? | Porquê |
| --- | --- | --- |
| Hospedagem Compartilhada | ❌ | Roda PHP, não roda Node nem Docker |
| Cloud Hosting | ❌ | Mesma limitação |
| **VPS (KVM)** | ✅ | Você tem root, roda Docker |

Se você já comprou compartilhada, vai precisar trocar — não tem como fazer funcionar.

**Qual VPS:** o **KVM 1** (1 vCPU, 4 GB RAM) aguenta bem. O app + Postgres + Caddy usam menos de 1 GB.

---

## 1. Criar o VPS

No painel da Hostinger → **VPS** → **Criar**:

- **Sistema operacional:** procure em *Aplicações* o template **Ubuntu 24.04 with Docker**. Se não achar, escolha **Ubuntu 24.04** puro (o passo 3 instala o Docker).
- **Senha root:** guarde, você vai usar no SSH.
- **Localização:** a mais próxima dos seus clientes.

Ao terminar, anote o **IP do servidor**.

---

## 2. Apontar o domínio

No painel de DNS do seu domínio (Hostinger ou onde ele estiver), crie:

| Tipo | Nome | Valor |
| --- | --- | --- |
| A | `support` | `IP-DO-SEU-VPS` |

Isso cria `support.seudominio.com`. A propagação leva de minutos a algumas horas.

**Confira antes de seguir** (no seu PC):
```powershell
nslookup support.seudominio.com
```
Tem que devolver o IP do VPS. Se não devolver, espere — o passo do HTTPS falha sem isso.

---

## 3. Conectar e preparar o servidor

No seu PC:
```powershell
ssh root@IP-DO-SEU-VPS
```

Já dentro do servidor:
```bash
# Só se você NÃO escolheu o template com Docker:
curl -fsSL https://get.docker.com | sh

# Confirma:
docker --version && docker compose version
```

---

## 4. Subir o código

**Opção A — via GitHub** (recomendado, facilita atualizar depois):
```bash
mkdir -p /opt/supportchat && cd /opt/supportchat
git clone https://github.com/SEU-USUARIO/SEU-REPO.git .
```

**Opção B — enviar do seu PC** (sem GitHub). No seu PC, na pasta do projeto:
```powershell
tar --exclude=node_modules --exclude=.next --exclude=.env.local --exclude=.env -czf app.tgz .
scp app.tgz root@IP-DO-SEU-VPS:/root/
```
No servidor:
```bash
mkdir -p /opt/supportchat && cd /opt/supportchat
tar -xzf /root/app.tgz && rm /root/app.tgz
```

---

## 5. Configurar

No servidor, dentro de `/opt/supportchat`:

```bash
cp .env.production.example .env
nano .env
```

Preencha assim (gere os segredos com os comandos abaixo):

```env
POSTGRES_USER=supportchat
POSTGRES_PASSWORD=<cole aqui>
POSTGRES_DB=supportchat

ANTHROPIC_API_KEY=sk-ant-api03-...
ADMIN_SECRET=<cole aqui>

# Modo atual: sem loja conectada, o agente escala para humano
SUPPORT_MODE=handoff

# A aplicação não envia email. Quando a retenção falha, a tela final dá ao
# cliente um link mailto: com a mensagem já escrita, e ele envia do próprio
# app de email. Este é o endereço de destino — precisa ser uma caixa que
# alguém lê. Não exige senha, SMTP nem DNS.
SUPPORT_EMAIL=suporte@northsupplements.online

# Agente real (não o mock)
MOCK_MODE=false
NEXT_PUBLIC_MOCK_MODE=false
MOCK_AI=false
```

Para gerar as senhas, rode antes e copie a saída:
```bash
openssl rand -base64 32   # POSTGRES_PASSWORD
openssl rand -base64 24   # ADMIN_SECRET
```

Salve com `Ctrl+O`, `Enter`, `Ctrl+X`.

Agora o domínio no Caddy:
```bash
nano Caddyfile
```
Troque a primeira linha por `support.seudominio.com {` e salve.

---

## 6. Subir

```bash
cd /opt/supportchat
docker compose up -d --build
```

A primeira vez demora 3–5 minutos. Acompanhe:
```bash
docker compose logs -f app
```
Espere aparecer `Ready in`. `Ctrl+C` sai do log (não derruba nada).

O Caddy emite o certificado HTTPS sozinho. Abra:

- Cliente: `https://support.seudominio.com`
- Admin: `https://support.seudominio.com/admin`

---

## 7. Conferir

Logado no admin, acesse `https://support.seudominio.com/api/diagnose`. Ele lista o que está configurado e o que falta.

---

## Comandos do dia a dia

```bash
cd /opt/supportchat

docker compose logs -f app        # ver logs
docker compose restart app        # reiniciar
docker compose down               # parar tudo
docker compose up -d              # subir de novo
```

**Atualizar depois de mudar o código:**
```bash
cd /opt/supportchat
git pull                          # ou reenvie o .tgz
docker compose up -d --build
```

**Editar o conhecimento do agente** — a pasta `knowledge/` é montada como volume, então **não precisa rebuild**:
```bash
nano /opt/supportchat/knowledge/_common.md
```
Vale na próxima conversa.

**Backup do banco:**
```bash
docker exec supportchat-postgres pg_dump -U supportchat supportchat > backup-$(date +%F).sql
```

---

## Se der errado

| Sintoma | Causa provável |
| --- | --- |
| Site não abre / erro de certificado | DNS ainda não propagou, ou o domínio no `Caddyfile` está diferente do DNS |
| `502 Bad Gateway` | O app não subiu — `docker compose logs app` |
| Admin recusa a senha | `ADMIN_SECRET` vazio no `.env` |
| Agente responde igual sempre | `MOCK_AI` não está `false` |
| `port is already allocated` | Algo já usa a 80/443 — `docker compose down` e tente de novo |

Log de tudo:
```bash
docker compose logs --tail=100
```

---

## Segurança mínima

```bash
# Firewall: só SSH e web
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable
```

O Postgres **não** fica exposto na internet — no `docker-compose.yml` ele está numa rede interna, sem porta publicada. Mantenha assim.
