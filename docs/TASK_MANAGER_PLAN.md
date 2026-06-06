# Task Manager — Plano de Implementação

> Doc autocontido. A branch/conversa onde isto foi desenhado não vai existir
> quando as fases forem executadas — leia de cima a baixo e siga; não assuma
> contexto prévio.
>
> **Nota de divergência:** existe `docs/TASKS_MODULE.md`, um design ANTERIOR e
> incompatível (SQLite, lista Linear-style, paridade VS Code, workspace
> independente de projects, attachments/comments/assignees/priorities). Este
> plano é o vigente e o substitui em intenção: storage JSON, kanban + daily,
> sem VS Code, workspace contendo projects, modelo enxuto. Em conflito, **este
> doc vence**.

---

## 1. Propósito & Escopo

Adicionar um task manager estilo issue do GitHub ao OpenChamber, com board
kanban e uma visão "daily" para relato de standup. Tasks pertencem a um
`workspace` (entidade nova = organização) que agrupa N projects existentes.

### Objetivos

- Modal issue-style: title, content (markdown), tags, project, branch, link de sessão.
- Board kanban (3 colunas) por workspace, cross-project.
- Visão daily: tasks por data, com carry-over de tasks em andamento até a conclusão.
- Botão + atalho na appbar para criar task; main view dedicada para o board.
- Entidade `workspace` para separar tasks de diferentes organizações.

### Não-objetivos (v1)

- Colunas customizáveis (3 fixas).
- assignees, priority, due date, attachments, comments, activity feed.
- Labels pré-definidas com cor por-workspace (tags são strings livres no v1).
- VS Code (explicitamente fora — esconder entry points lá).
- Multi-usuário / backend remoto / colaboração ao vivo.
- Swimlanes por project, calendar, timeline (roadmap).

### Runtimes

- **Web + Desktop (Electron):** suportados. O Electron sobe o Express
  in-process, então `runtimeFetch('/api/...')` funciona nos dois.
- **VS Code:** fora de escopo. Entry points escondidos via `isVSCodeWebview()`.

---

## 2. Decisões Travadas (Q1–Q16)

| # | Decisão | Motivo | Rejeitado |
|---|---------|--------|-----------|
| Q1 | Workspace **contém N projects** | Único modelo que casa "diferentes organizações" + branch real na task | Independente de projects; ≈project 1:1; rótulo solto |
| Q2 | **1 project → exatamente 1 workspace**; membership reusa `settings.projects[]` | Espelha repo/org do GitHub; escopo de task não-ambíguo; migração trivial | M:N (ambíguo); lista própria de diretórios (drift) |
| Q3 | **Server-side**, JSON: `workspaces.json` + `workspace-tasks/<id>.json` | Trabalho real não pode sumir; views por-workspace = 1 read; padrão do repo | localStorage-only; per-project (fragmenta daily); monolito único |
| Q4 | Modelo de Task enxuto (ver §3); tags = strings livres; sessionId opcional; sem due/priority | v1 enxuto, modal não incha | Labels com cor; due/priority no v1 |
| Q5 | **3 colunas fixas** todo/in_progress/done + semântica sticky de datas | Daily determinística sem config | Backlog extra; colunas customizáveis (precisa mapear iniciada/concluída) |
| Q6 | Daily = **date-picker único + 2 seções derivadas** dos timestamps; "arrastar" = carry-over automático + drag-to-concluir | Bate o texto do usuário; 100% determinística sem snapshots | Timeline multi-dia; snapshots por-dia |
| Q7 | Task manager tem **seletor próprio de workspace** (default = workspace do dir atual) | Daily é cross-project; não acopla o app inteiro | Auto-seguir diretório; workspace global regendo o app |
| Q8 | Kanban = **board único do workspace** (todos os projects), badge project+branch, filtro opcional | Consistente com a daily; modelo "board da org" | 1 project por vez; swimlanes (evolução) |
| Q9 | Casa do task manager = **main view** (`activeMainTab='tasks'`) | Kanban precisa de largura; padrão GitView/DiffView | Painel direito (estreito); painel esquerdo (conflita com sessões) |
| Q10 | 2 atalhos (`create_task=mod+shift+i`, `toggle_task_manager=mod+shift+k`) + 2 botões na appbar + modal global com pré-fill + 2 comandos no palette | Acesso direto a criar (req 4) + abrir board | 1 botão só |
| Q11 | Branch = **referência (dados)** + **ações sob demanda** (checkout/abrir sessão). Sem criar branch na criação da task | Criação safe/rápida; branch real e acionável | Criar branch/worktree no momento da criação |
| Q12 | `runtimeFetch('/api/...')` direto de store; módulo server próprio; SSE via `/api/openchamber/events`; throw em falha de fetch autoritativo; guard VS Code | Sem VS Code = sem bridge; mais leve; precedente scheduled-tasks/session-folders | Sub-API formal `RuntimeAPIs` (custo de bridge sem VS Code) |
| Q13 | Gestão **híbrida**: switcher inline (trocar/criar) + seção Settings "Workspaces" (CRUD); membership atribuída no próprio project (1:1) | Hot path inline; config pesada em Settings | Tudo em Settings; tudo inline |
| Q14 | Detalhe/edição = **reusa o modal** de criação em modo edição | Bate "modal issue-style"; 1 componente | Drawer lateral; master-detail |
| Q15 | Drag = **@dnd-kit** (skill `drag-to-reorder`): kanban mover+reordenar, daily drag-to-concluir; otimista+rollback+SSE; `order` inteiro renormalizado no drop | Skill cobre desktop+touch+pitfalls | — |
| Q16 | Store de UI dedicado persistido (`activeWorkspaceId`/`viewMode`/`projectFilter`); data da daily efêmera (sempre Hoje); empty/error states explícitos | Store-splitting; standup é sobre hoje; não blank em erro | Jogar estado no `useUIStore`; persistir data |

Reabrir qualquer decisão exige reescrever as seções afetadas.

---

## 3. Modelo de Dados

```ts
type Workspace = {
  id: string;            // randomUUID (precedente project-config.js)
  name: string;          // <= 80
  color?: string;        // nome de token de tema (não hex)
  projectIDs: string[];  // membership; projectID = path_<base64url>
  createdAt: number;     // epoch ms
};

type TaskStatus = 'todo' | 'in_progress' | 'done';

type Task = {
  id: string;            // randomUUID
  title: string;         // obrigatório, <= 200
  content: string;       // markdown, <= 20000
  tags: string[];        // strings livres
  projectId: string | null;  // qual repo do workspace (resolve a branch)
  branch: string | null;     // nome da branch nesse project
  sessionId: string | null;  // link opcional p/ sessão OpenCode
  status: TaskStatus;
  order: number;             // posição dentro da coluna
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;   // 1ª vez que entrou em in_progress
  completedAt: number | null; // setado ao entrar em done
};
```

- `workspaceId` **não** entra no record da Task (o arquivo já é por-workspace = fonte de verdade; evita drift).
- IDs `randomUUID`. Timestamps epoch ms, server-generated. `updatedAt` reescrito em toda mutação.

### 3.1 Semântica sticky de transição (autoritativa no server)

| Transição | Efeito |
|---|---|
| `→ in_progress` | `startedAt = now` **somente se null** (sticky depois) |
| `→ done` | `completedAt = now` |
| `done → qualquer` (reabrir) | `completedAt = null` |
| qualquer | `startedAt` **nunca** limpa após setado |

Aplicada na mesma função de update, atômica. UI espelha, mas server é
autoritativo (regra AGENTS policy-first).

### 3.2 Derivação da daily (sem snapshots)

Para um dia `D` (timezone local, virada à meia-noite local):

- **Em andamento (doing) em D:** `startedAt <= fimDoDia(D) && (completedAt == null || completedAt > fimDoDia(D))`
- **Concluída (done) em D:** `startOfDay(D) <= completedAt <= endOfDay(D)`

Exemplo (início 01/02, conclusão 05/02): aparece como **doing** em
01–04/02, como **done** em 05/02, e some em 06/02+. Tudo derivado dos 2
timestamps — "arrastar até a conclusão" é automático.

---

## 4. Persistência (server, web + desktop)

```
~/.config/openchamber/            # OPENCHAMBER_DATA_DIR (override por env)
  workspaces.json                      # { version: 1, workspaces: Workspace[] }
  workspace-tasks/<workspaceID>.json   # { version: 1, tasks: Task[] }
```

- Write atômico (`tmp-<pid>-<ts>` + `rename`), lock de escrita por chave,
  payload versionado, leitura tolerante a ENOENT. Molde:
  `packages/web/server/lib/projects/project-config.js`.
- Diretório recebido por DI (`openchamberDataDir`), **não** reler env por módulo.

---

## 5. Backend

### 5.1 Módulo novo

```
packages/web/server/lib/tasks/
  runtime.js          # persistência + lógica (transições sticky, validação)
  routes.js           # registerTasksRoutes(app, deps) — handlers Express
  DOCUMENTATION.md    # doc do módulo (convenção do repo)
```

`runtime.js` segue o padrão `project-config.js`/`magic-prompts`: funções
`read*`/`write*` com `withWriteLock`, validação/normalização de campos
(title <=200, content <=20000, status no enum, tags array de strings).

### 5.2 Rotas

```
# Workspaces
GET    /api/workspaces
POST   /api/workspaces                         { name, color?, projectIDs? }
GET    /api/workspaces/:id
PUT    /api/workspaces/:id                      { name?, color?, projectIDs? }
DELETE /api/workspaces/:id

# Tasks (escopo workspace)
GET    /api/workspaces/:id/tasks
POST   /api/workspaces/:id/tasks               { title, content?, tags?, projectId?, branch?, sessionId?, status? }
PUT    /api/workspaces/:id/tasks/:taskId       Partial<Task> (status aplica §3.1)
DELETE /api/workspaces/:id/tasks/:taskId
```

- Erro: `{ error, code? }` com status apropriado (`400` validação, `404`
  não encontrado, `409` conflito, `422` transição ilegal, `500`).
- Cada mutação emite SSE (§5.3).

### 5.3 SSE

Emitir no stream existente `/api/openchamber/events` via
`getOpenChamberEventClients` + `writeSseEvent` (precedente: scheduled-tasks
em `packages/web/server/lib/scheduled-tasks/routes.js`). Eventos:

```
workspace.created   { workspace }
workspace.updated   { id, patch }
workspace.deleted   { id }
task.created        { workspaceId, task }
task.updated        { workspaceId, id, patch }
task.deleted        { workspaceId, id }
```

Payload mínimo; consumidor hidrata via GET quando precisa de mais.

### 5.4 Registro

Tocar `packages/web/server/lib/opencode/feature-routes-runtime.js`:
chamar `registerTasksRoutes(app, { fsPromises, path, openchamberDataDir, getOpenChamberEventClients, writeSseEvent })`.

---

## 6. Cliente

### 6.1 Transporte

`runtimeFetch('/api/...')` direto dos stores. Sem sub-API `RuntimeAPIs`, sem
bridge VS Code. **Métodos autoritativos** (list/get que substituem estado)
**dão throw em falha** — nunca engolem para `[]` (regra AGENTS "fetch failure
≠ empty success"). Helpers em `packages/ui/src/lib/tasks/api.ts`.

### 6.2 Stores (split por frequência — regra de performance AGENTS)

| Store | Conteúdo | Frequência |
|---|---|---|
| `useWorkspacesStore` | lista de workspaces + membership; current id | baixa (ação do usuário) |
| `useTasksStore` | tasks do workspace ativo (cache keyed por workspaceId); otimista + rollback; reconcilia por SSE | média (SSE + usuário) |
| `useTaskManagerUIStore` (persist) | `activeWorkspaceId`, `viewMode: 'kanban'\|'daily'`, `projectFilter` | média |

Regras de seletor (obrigatórias): `useTask(id)` retorna 1 task; nunca expor o
Map inteiro; rows resolvem o próprio dado; reducers preservam referências de
entidades não tocadas.

Data selecionada da daily = **efêmera**, component-local, default sempre Hoje.

### 6.3 SSE bridge

Assinar `subscribeOpenchamberEvents` (`packages/ui/src/lib/openchamberEvents.ts`),
despachar para os stores via `getState()`. Reducers shallow-merge só dos
campos mudados; retornam a mesma referência quando nada muda; coalescem
`task.updated` da mesma entidade.

---

## 7. UI

### 7.1 Main view (`activeMainTab='tasks'`)

```
components/views/TaskManagerView.tsx      # entry, lazyWithChunkRecovery
components/tasks/
  TaskManagerHeader.tsx     # WorkspaceSwitcher + toggle Kanban/Daily + filtro project
  WorkspaceSwitcher.tsx     # trocar / "+ Novo workspace" / "Gerenciar…"
  KanbanBoard.tsx           # 3 colunas, DndContext
  KanbanColumn.tsx          # droppable; placeholder vazio
  TaskCard.tsx              # React.memo c/ comparator; badge project+branch+tags
  DailyView.tsx             # navegação de data + 2 seções derivadas
  DailyDateNav.tsx          # stepper < [Hoje] > + date-picker (calendário)
  TaskModal.tsx             # criar+editar (issue-style)
```

- **Kanban:** board do workspace inteiro (Q8); filtro de project opcional;
  card mostra project + branch + tags.
- **Daily:** `DailyDateNav` (stepper `< [Hoje] >` **e** date-picker) + seções
  "Em andamento" (carry-over) e "Concluídas no dia", derivadas (§3.2). Drag
  de Em andamento → Concluídas seta `completedAt=now`.

### 7.2 TaskModal (criar + editar)

Campos: title, content (markdown write/preview reusando o renderer do chat),
tags (input de chips livres), project (dropdown dos N do workspace), branch
(autocomplete via `getGitBranches(projectDir)`; texto livre se project null),
status, link de sessão, timestamps read-only (created/started/completed),
ações de branch (checkout / abrir sessão — Q11), botão deletar (em edição).

**Pré-fill por contexto:** aberto de um chat em project X / branch Y →
`workspace`=do dir atual, `project=X`, `branch=Y`, `sessionId`=sessão atual,
`status=todo`.

### 7.3 Appbar + atalhos + palette

- Header `desktopSidebarActions` (`packages/ui/src/components/layout/Header.tsx`):
  2 `HeaderIconActionButton` — "New task" (abre modal) e "Task manager"
  (abre board, `pressed` quando ativo).
- `packages/ui/src/lib/shortcuts.ts`: `create_task` (`mod+shift+i`),
  `toggle_task_manager` (`mod+shift+k`), ambos `customizable`.
- `packages/ui/src/hooks/useKeyboardShortcuts.ts`: handlers dos dois.
- `packages/ui/src/components/ui/CommandPalette.tsx`: "New task" + "Open task manager".

### 7.4 Settings — seção Workspaces

`packages/ui/src/components/sections/workspaces/` (skill `settings-ui-patterns`):
CRUD de workspace (nome, cor via token, deletar), lista de membros
(projects). Atribuição de project ao workspace também via dropdown
"Workspace" na linha do project (ProjectActions / Settings de projects),
dado o 1:1 (Q13).

---

## 8. Drag (@dnd-kit)

Skill obrigatória `drag-to-reorder` (desktop + touch, variable-width,
wrapping, evitar loop de update e overlay deslocado).

- **Kanban:** mover card entre colunas → muda `status` + aplica §3.1;
  reordenar dentro da coluna → muda `order`.
- **Daily:** arrastar Em andamento → Concluídas → `completedAt=now`. Sem
  reordenação.
- **Drop:** update otimista no store + PUT no server + **rollback em erro** +
  reconciliação por SSE.
- **Ordering:** `order` inteiro; no drop, renormaliza a coluna afetada e
  persiste só as tasks mudadas (N pequeno; evita fractional-index drift).
- Corte seguro sob pressão de escopo: reordenar-dentro-da-coluna (mover entre
  colunas e datas é essencial).

---

## 9. Migração

Primeiro boot: criar workspace **"Default"** e mover todos os
`settings.projects[]` existentes para ele (`projectIDs`). Project novo cai no
"Default" até ser reatribuído. Sem isso o board abre vazio/confuso.

Implementar idempotente: se `workspaces.json` ausente/vazio, criar Default
com os projects atuais; nunca duplicar em boots seguintes.

---

## 10. Estado de UI + Empty/Error

- UI state em `useTaskManagerUIStore` (persist): `activeWorkspaceId` (default
  = workspace do dir atual), `viewMode`, `projectFilter` (por workspace,
  default "all"). Data da daily efêmera (sempre Hoje ao abrir).
- **Empty states** (strings i18n via `locale-ui-patterns`, cores via
  `theme-system`): workspace "Default" vazio → guia "adicione project / crie
  task"; board vazio → CTA "Criar primeira task"; coluna vazia → placeholder;
  daily sem atividade no dia → "Nenhuma task trabalhada nesse dia".
- **Erro de fetch:** estado de erro com retry, **preservando o último board
  bom** (não blank a tela num blip — regra AGENTS).

---

## 11. Cross-runtime

- Web + Desktop: `runtimeFetch('/api/...')` funciona (Electron sobe Express
  in-process).
- VS Code: **fora**. Esconder botões/atalhos/view atrás de `isVSCodeWebview()`
  (precedente `useSessionFoldersStore`). Sem bridge, sem stub.

---

## 12. Skills obrigatórias na implementação

| Trabalho | Skill |
|---|---|
| stores/runtimeFetch/rotas server | `ui-api-decoupling` |
| cores, ícones, componentes UI | `theme-system` |
| qualquer string user-facing | `locale-ui-patterns` |
| seção Settings Workspaces | `settings-ui-patterns` |
| dnd-kit kanban/daily | `drag-to-reorder` |

---

## 13. Regras AGENTS aplicáveis (binding)

- `TaskCard` = `React.memo` com comparator custom (id, status, order, title,
  tags hash, branch, projectId, updatedAt) — não comparar por referência.
- Handlers SSE: gate em boolean barato antes de `findIndex`/`filter`;
  retornar `false`/mesma referência em no-op.
- Stores split por frequência; reads cross-store via `.getState()`.
- Otimista: update no store + PUT + rollback; reconciliação por SSE.
- Diretório lido dinâmico (`opencodeClient.getDirectory()`), nunca cacheado em closure.
- Não sortear o board direto de campos high-churn; `order` é a fonte de ordenação.

---

## 14. Inventário de Arquivos

### 14.1 Novos

```
packages/web/server/lib/tasks/
  runtime.js
  routes.js
  DOCUMENTATION.md

packages/ui/src/lib/tasks/
  types.ts          # Workspace, Task, TaskStatus
  api.ts            # runtimeFetch wrappers (throw em falha autoritativa)
  helpers.ts        # transições sticky (espelho client) + derivação daily

packages/ui/src/stores/
  useWorkspacesStore.ts
  useTasksStore.ts
  useTaskManagerUIStore.ts

packages/ui/src/components/views/
  TaskManagerView.tsx
packages/ui/src/components/tasks/
  TaskManagerHeader.tsx
  WorkspaceSwitcher.tsx
  KanbanBoard.tsx
  KanbanColumn.tsx
  TaskCard.tsx
  DailyView.tsx
  DailyDateNav.tsx
  TaskModal.tsx
packages/ui/src/components/sections/workspaces/
  index.ts
  WorkspacesSection.tsx

packages/ui/src/lib/i18n/messages/*.tasks.ts   # namespace tasks.*
```

### 14.2 Tocados

| Arquivo | Mudança |
|---|---|
| `packages/web/server/lib/opencode/feature-routes-runtime.js` | registrar `registerTasksRoutes` com DI |
| `packages/ui/src/stores/useUIStore.ts` | `MainTab` += `'tasks'` |
| `packages/ui/src/components/layout/MainLayout.tsx` | `secondaryView` case `'tasks'` (lazy) |
| `packages/ui/src/components/layout/Header.tsx` | 2 botões em `desktopSidebarActions` (guard `isVSCodeWebview`) |
| `packages/ui/src/lib/shortcuts.ts` | actions `create_task` / `toggle_task_manager` |
| `packages/ui/src/hooks/useKeyboardShortcuts.ts` | handlers dos 2 atalhos |
| `packages/ui/src/components/ui/CommandPalette.tsx` | 2 comandos |
| `packages/ui/src/components/views/SettingsView.tsx` | registrar seção Workspaces |
| ProjectActions / linha de project em Settings | dropdown "Workspace" (membership) |
| `packages/ui/src/lib/i18n/messages/en.settings.ts` | labels dos atalhos |
| `AGENTS.md` (documentation map) | entrada p/ `lib/tasks/DOCUMENTATION.md` |

### 14.3 Dependências

Nenhuma nova. `@dnd-kit`, markdown renderer, Base UI, zustand — já presentes.

---

## 15. Entrega Faseada

Cada fase exige `bun run type-check` + `bun run lint` verdes antes de fechar.
Fases de UI exigem checagem rápida de re-render (digitar no modal não deve
re-renderizar board/colunas alheias).

| Fase | Escopo | Aceite |
|---|---|---|
| **F0 — Backend** | módulo `lib/tasks` (runtime + routes), persistência JSON, transições sticky server-side, SSE, registro em feature-routes | curl em todas as rotas; mutação emite SSE; transição ilegal → erro |
| **F1 — Migração + stores** | migração Default; `useWorkspacesStore`, `useTasksStore`, `useTaskManagerUIStore`; SSE bridge; throw-on-failure | 2 abas/janelas sincronizam após criar/mover task; projects existentes no Default |
| **F2 — Main view shell** | `MainTab='tasks'`, `TaskManagerView`, header, WorkspaceSwitcher, toggle Kanban/Daily, empty states | board abre via `activeMainTab`; troca de workspace; empty states |
| **F3 — Kanban + cards** | colunas, `TaskCard`, dnd-kit mover+reordenar, semântica sticky no drop, filtro project | criar/mover/concluir/reabrir; ordem persiste |
| **F4 — TaskModal** | criar+editar issue-style, markdown write/preview, tags, project+branch picker, ações de branch, link de sessão, pré-fill | fluxo criar→editar→deletar; pré-fill do chat |
| **F5 — Daily view** | `DailyDateNav` (stepper + picker), 2 seções derivadas, drag-to-concluir | carry-over correto (01–04 doing, 05 done); navegação de data; sempre Hoje ao abrir |
| **F6 — Entry points** | 2 botões appbar, 2 atalhos, 2 comandos no palette, guard VS Code | atalhos funcionam; escondido no VS Code |
| **F7 — Settings Workspaces** | seção CRUD + dropdown de workspace no project | criar/renomear/cor/deletar workspace; reatribuir project |
| **F8 — Polish** | i18n completo, tema nos 30 temas, audit de performance, `AGENTS.md` doc map | audit passa; release-ready |

---

## 16. Fora de Escopo / Roadmap

1. Colunas customizáveis por workspace (+ mapeamento iniciada/concluída).
2. Swimlanes por project no kanban.
3. assignees, priority, due date.
4. Labels com cor por-workspace.
5. attachments, comments, activity feed.
6. Paridade VS Code (bridge + SSE proxy).
7. Timeline multi-dia na daily.
8. M:N project↔workspace.

---

## 17. Riscos & Mitigações

| Risco | Mitigação |
|---|---|
| SSE `/api/openchamber/events` não conecta no VS Code | Feature fora do VS Code; entry points escondidos |
| Blip de rede apaga tasks | Métodos autoritativos dão throw; caller preserva estado |
| Re-render fanout no streaming/drag | Stores split; `TaskCard` memo+comparator; `useTaskManagerUIStore` separado do `useUIStore` |
| Membership órfã (project removido de settings) | `projectIDs` tolerante a ID inexistente; UI ignora ausentes |
| Colisão de atalho | `mod+shift+i` / `mod+shift+k` verificados livres em `shortcuts.ts`; `customizable` |
| Daily por timezone | Local da máquina, virada à meia-noite local; derivação de `start/endOfDay` num único helper |
