# session-hud

Mod do Claude Code que mostra o uso da sessão numa faixa de uma linha acima do prompt:

```
◔ Contexto 25%  50k/200k  │  ◑ 5h 42%  zera em 2h00  │  ◔ 7d 18%  zera em 4d  │  Detalhes
```

- **Contexto** — medido como o `/context` (tokens da última resposta sobre a janela de compactação), com marca no ponto de auto-compactação.
- **5h / 7d** — limites do plano e quando zeram. Alerta `⚠ acaba em ~X` só na janela de 5h, a partir de 70%, quando o ritmo da última hora chega a 100% antes de zerar.
- **Detalhes** (ou `/hud detalhes`) — painel com contexto por categoria, ritmo dos limites, custo da sessão (equivalente API), tokens por modelo e histórico de turnos.
- `/hud` mostra/oculta a faixa.

Funciona no terminal e no app desktop.

## Instalar

**Windows — cole no PowerShell:**

```powershell
irm https://raw.githubusercontent.com/HenriqueRicieri/session-hud/main/install.ps1 | iex
```

Acha o Claude Code (inclusive o que vem no app desktop), instala no escopo **user** (permanente) e liga `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` no `~/.claude/settings.json` (com backup). Depois é só abrir uma sessão nova.

**Qualquer sistema — dois comandos no terminal:**

```
claude plugin marketplace add HenriqueRicieri/session-hud
claude plugin install session-hud@session-hud --scope user
```

Mods de função ainda são early access: se a faixa não aparecer, adicione ao `env` do `~/.claude/settings.json` e abra uma sessão nova:

```json
"env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" }
```

## Atualizar

```
claude plugin update session-hud@session-hud
```

Depois `/reload-plugins` numa sessão aberta, ou abra uma nova.

## Desenvolver

```
claude plugin validate .
claude plugin test .
```

Para testar mudanças sem reinstalar, aponte `CLAUDE_CODE_PLUGIN_DIRS` para esta pasta no `env` do settings.
