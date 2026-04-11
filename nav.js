/**
 * tw-web shared chrome — two-bar responsive layout.
 * Inject with: <script src="/nav.js"></script> in <head>.
 *
 * Bar 1 — nav bar (sticky, dark):
 *   left:  logo | Taskwarrior | List | Kanban | Day Planner | Calendar
 *   right: [filter…][×]  [+]
 *
 * Bar 2 — button bar (scrolls, slightly lighter):
 *   left:  context buttons (from /api/contexts)
 *   right: [Pending] [Recurring] [Waiting] [Completed] [Deleted]
 *
 * State is persisted in localStorage and broadcast via CustomEvent
 * 'tw-filter-change' so pages can re-fetch from the server.
 *
 * Public API:  window.twNav.getState()
 *              window.twNav.setState(patch)
 *              window.twNav.stateToParams(state?)
 */
(function () {
    'use strict';

    // ── Config ────────────────────────────────────────────────────────────────
    const BREAK     = 860;          // px — stack bars below this width
    const NARROW    = 400;          // px — shorten brand name below this width
    const STATE_KEY = 'tw-nav-state';
    const DEBOUNCE  = 400;          // ms — filter input debounce

    const PAGES = [
        { id: 'tasks',    href: '/',                      label: 'List' },
        { id: 'kanban',   href: '/kanban.html',           label: 'Kanban' },
        { id: 'planner',  href: '/day-planner.html',      label: 'Day Planner' },
        { id: 'calendar', href: '/calendar-planner.html', label: 'Calendar' },
    ];

    const STATUS_BTNS = [
        { id: 'pending',   label: 'Pending'   },
        { id: 'recurring', label: 'Recurring' },
        { id: 'waiting',   label: 'Waiting'   },
        { id: 'completed', label: 'Completed' },
        { id: 'deleted',   label: 'Deleted'   },
    ];

    // ── State ─────────────────────────────────────────────────────────────────
    function defaultState() {
        return { statuses: ['pending'], filter: '', context: '', project: '', tags: '' };
    }

    function getState() {
        try {
            return JSON.parse(localStorage.getItem(STATE_KEY)) || defaultState();
        } catch { return defaultState(); }
    }

    function setState(patch, { clientOnly = false } = {}) {
        const next = Object.assign({}, getState(), patch);
        localStorage.setItem(STATE_KEY, JSON.stringify(next));
        _applyState(next);
        document.dispatchEvent(new CustomEvent('tw-filter-change', { detail: { ...next, clientOnly } }));
    }

    function stateToParams(state) {
        state = state || getState();
        const p = new URLSearchParams();
        if (state.statuses && state.statuses.length) p.set('status', state.statuses.join(','));
        if (state.context) p.set('context', state.context);
        // filter/project/tags are applied client-side; total stays rock-solid
        return p.toString();
    }

    function setCount(filtered, total) {
        const el = document.getElementById('tw-count');
        if (!el) return;
        el.textContent = filtered === total ? String(total) : `${filtered}/${total}`;
    }

    window.twNav = { getState, setState, stateToParams, setCount };

    // ── Helpers ───────────────────────────────────────────────────────────────
    function activePage() {
        const p = window.location.pathname;
        if (p.endsWith('kanban.html'))           return 'kanban';
        if (p.endsWith('day-planner.html'))      return 'planner';
        if (p.endsWith('calendar-planner.html')) return 'calendar';
        return 'tasks';
    }

    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

    // ── CSS ───────────────────────────────────────────────────────────────────
    const CSS = `
#tw-nav-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 50px;
    padding: 0 14px 0 0;
    background: #1a1a1a;
    position: sticky;
    top: 0;
    z-index: 9999;
    box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    gap: 8px;
    box-sizing: border-box;
}
#tw-btn-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 50px;
    padding: 0 14px;
    background: #2c3e50;
    gap: 12px;
    box-sizing: border-box;
}
.tw-bar-left  { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; }
.tw-bar-right { display: flex; align-items: center; gap: 4px; flex-shrink: 1; }

/* logo (refresh button) + brand name (about link) */
.tw-logo-btn {
    background: none; border: none; cursor: pointer; padding: 0;
    flex-shrink: 0; display: flex; align-items: center;
}
.tw-logo-btn:hover { opacity: 0.85; }
.tw-logo { height: 50px; width: 50px; display: block; }
.tw-brand-name {
    text-decoration: none; color: #fff; font-weight: 600; font-size: 18px;
    white-space: nowrap; opacity: 0.9; flex-shrink: 0; margin-right: 4px;
}
.tw-brand-name:hover { opacity: 1; color: #fff; }
.tw-name-short { display: none; }

/* nav links */
.tw-nav-link {
    padding: 3px 9px; border-radius: 4px; text-decoration: none;
    color: rgba(255,255,255,0.75); font-size: 14px; white-space: nowrap;
}
.tw-nav-link:hover  { background: rgba(255,255,255,0.12); color: #fff; }
.tw-nav-link.active { background: #3498db; color: #fff; }

/* filter inputs */
.tw-filter-wrap {
    display: flex; align-items: center;
    background: rgba(255,255,255,0.1); border-radius: 4px; padding: 0 6px; gap: 3px;
}
.tw-filter-wrap:focus-within { background: rgba(255,255,255,0.18); }
.tw-filter-wrap input {
    background: transparent; border: none; outline: none;
    color: #fff; font-size: 14px; padding: 5px 0;
}
.tw-filter-wrap input::placeholder { color: rgba(255,255,255,0.35); }
#tw-filter-input  { width: 130px; min-width: 40px; }
#tw-project-input { width: 110px; min-width: 40px; }
#tw-tags-input    { width: 90px;  min-width: 40px; }
.tw-inp-clear {
    background: none; border: none; color: rgba(255,255,255,0.45);
    cursor: pointer; font-size: 16px; padding: 0 1px; line-height: 1;
    display: none;
}
.tw-inp-clear.vis { display: block; }
.tw-inp-clear:hover { color: #fff; }

/* task count */
.tw-count {
    color: rgba(255,255,255,0.7); font-size: 18px; white-space: nowrap; min-width: 44px; text-align: right; font-weight: 500;
}

/* add button */
#tw-add-btn {
    width: 28px; height: 28px; border-radius: 50%;
    background: #555; border: none; color: #fff; font-size: 22px; line-height: 1;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; padding: 0 0 1px 0;
}
#tw-add-btn:hover { background: #777; }

/* button bar buttons */
.tw-ctx-btn, .tw-status-btn {
    padding: 3px 9px; border-radius: 4px; border: none; font-size: 14px;
    cursor: pointer; white-space: nowrap;
    color: rgba(255,255,255,0.75); background: rgba(255,255,255,0.08);
}
.tw-ctx-btn:hover,    .tw-status-btn:hover    { background: rgba(255,255,255,0.18); color: #fff; }
.tw-ctx-btn.active                             { background: #27ae60; color: #fff; }
.tw-status-btn.active                          { background: #3498db; color: #fff; }

/* responsive — stack at narrow widths */
@media (max-width: ${BREAK}px) {
    #tw-nav-bar, #tw-btn-bar {
        height: auto; flex-wrap: wrap; padding: 5px 10px; gap: 4px;
    }
    .tw-bar-left  { flex-wrap: wrap; width: 100%; justify-content: flex-start; }
    .tw-bar-right { flex-wrap: wrap; width: 100%; justify-content: flex-end; }
    #tw-filter-input, #tw-project-input, #tw-tags-input { width: 80px; min-width: 30px; }
}
/* minimum width — shorten brand name */
@media (max-width: ${NARROW}px) {
    .tw-name-full { display: none; }
    .tw-name-short { display: inline; }
}
`;

    // ── HTML builders ─────────────────────────────────────────────────────────
    function buildNavBar(active) {
        const links = PAGES.map(p =>
            `<a href="${p.href}" class="tw-nav-link${p.id === active ? ' active' : ''}">${p.label}</a>`
        ).join('');

        return (
            `<div class="tw-bar-left">` +
                `<button id="tw-logo-refresh" class="tw-logo-btn" title="Refresh">` +
                    `<img src="/logo.svg" alt="Taskwarrior" class="tw-logo">` +
                `</button>` +
                `<a href="/about.html" class="tw-brand-name">` +
                    `<span class="tw-name-full">Taskwarrior</span>` +
                    `<span class="tw-name-short">Task</span>` +
                `</a>` +
                links +
            `</div>` +
            `<div class="tw-bar-right">` +
                `<div class="tw-filter-wrap">` +
                    `<input id="tw-filter-input"  type="text" placeholder="filter…"  autocomplete="off">` +
                    `<button class="tw-inp-clear" id="tw-filter-clear"  title="Clear">×</button>` +
                `</div>` +
                `<div class="tw-filter-wrap">` +
                    `<input id="tw-project-input" type="text" placeholder="project…" autocomplete="off">` +
                    `<button class="tw-inp-clear" id="tw-project-clear" title="Clear">×</button>` +
                `</div>` +
                `<div class="tw-filter-wrap">` +
                    `<input id="tw-tags-input"    type="text" placeholder="tags…"    autocomplete="off">` +
                    `<button class="tw-inp-clear" id="tw-tags-clear"   title="Clear">×</button>` +
                `</div>` +
                `<span id="tw-count" class="tw-count"></span>` +
                `<button id="tw-add-btn" title="Add task">+</button>` +
            `</div>`
        );
    }

    function buildCtxBtns(state, contexts) {
        return [
            `<button class="tw-ctx-btn${!state.context ? ' active' : ''}" data-ctx="">All</button>`,
            ...contexts.map(c =>
                `<button class="tw-ctx-btn${state.context === c ? ' active' : ''}" data-ctx="${c}">${cap(c)}</button>`)
        ].join('');
    }

    function buildBtnBar(state, contexts) {
        const ctxBtns = buildCtxBtns(state, contexts);

        const statusBtns = STATUS_BTNS.map(s =>
            `<button class="tw-status-btn${state.statuses.includes(s.id) ? ' active' : ''}" data-status="${s.id}">${s.label}</button>`
        ).join('');

        return (
            `<div class="tw-bar-left"  id="tw-ctx-btns">${ctxBtns}</div>` +
            `<div class="tw-bar-right" id="tw-status-btns">${statusBtns}</div>`
        );
    }

    // ── Apply state to live DOM ───────────────────────────────────────────────
    function _applyState(state) {
        [
            ['tw-filter-input',  'tw-filter-clear',  state.filter  || ''],
            ['tw-project-input', 'tw-project-clear', state.project || ''],
            ['tw-tags-input',    'tw-tags-clear',    state.tags    || ''],
        ].forEach(([inpId, clrId, val]) => {
            const inp = document.getElementById(inpId);
            const clr = document.getElementById(clrId);
            if (inp && inp.value !== val) inp.value = val;
            if (clr) clr.classList.toggle('vis', !!val);
        });

        document.querySelectorAll('.tw-ctx-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.ctx === state.context));

        document.querySelectorAll('.tw-status-btn').forEach(b =>
            b.classList.toggle('active', state.statuses.includes(b.dataset.status)));
    }

    // ── Event wiring ──────────────────────────────────────────────────────────
    function bindEvents() {
        // Wire a text input + clear button into the state, with debounce.
        // clientOnly=true means pages re-filter in-memory rather than re-fetching.
        function wireInput(inpId, clrId, stateKey, clientOnly = false) {
            const inp = document.getElementById(inpId);
            const clr = document.getElementById(clrId);
            let timer;
            inp.addEventListener('input', () => {
                clr.classList.toggle('vis', !!inp.value);
                clearTimeout(timer);
                timer = setTimeout(() => setState({ [stateKey]: inp.value }, { clientOnly }), DEBOUNCE);
            });
            clr.addEventListener('click', () => {
                inp.value = '';
                clr.classList.remove('vis');
                setState({ [stateKey]: '' }, { clientOnly });
            });
        }

        wireInput('tw-filter-input',  'tw-filter-clear',  'filter',  true);
        wireInput('tw-project-input', 'tw-project-clear', 'project', true);
        wireInput('tw-tags-input',    'tw-tags-clear',    'tags',    true);

        document.getElementById('tw-logo-refresh').addEventListener('click', () =>
            document.dispatchEvent(new CustomEvent('tw-filter-change', { detail: getState() })));

        document.getElementById('tw-add-btn').addEventListener('click', () =>
            document.dispatchEvent(new CustomEvent('tw-open-add')));

        document.getElementById('tw-ctx-btns').addEventListener('click', e => {
            const b = e.target.closest('.tw-ctx-btn');
            if (b) setState({ context: b.dataset.ctx });
        });

        document.getElementById('tw-status-btns').addEventListener('click', e => {
            const b = e.target.closest('.tw-status-btn');
            if (!b) return;
            setState({ statuses: [b.dataset.status] });
        });
    }

    // ── Context cache (sessionStorage) ───────────────────────────────────────
    const CTX_KEY = 'tw-contexts';
    function getCachedContexts() {
        try { return JSON.parse(sessionStorage.getItem(CTX_KEY)) || []; }
        catch { return []; }
    }
    function setCachedContexts(list) {
        try { sessionStorage.setItem(CTX_KEY, JSON.stringify(list)); } catch {}
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    function init() {
        const style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);

        const state    = getState();
        const active   = activePage();
        const contexts = getCachedContexts();   // instant — no API wait

        const navBar = document.createElement('div');
        navBar.id = 'tw-nav-bar';
        navBar.innerHTML = buildNavBar(active);

        const btnBar = document.createElement('div');
        btnBar.id = 'tw-btn-bar';
        btnBar.innerHTML = buildBtnBar(state, contexts);

        // nav bar on top, button bar immediately below
        document.body.insertBefore(btnBar, document.body.firstChild);
        document.body.insertBefore(navBar, document.body.firstChild);

        _applyState(state);
        bindEvents();

        // Refresh contexts in background — update buttons silently if the list changed
        fetchContexts().then(fresh => {
            setCachedContexts(fresh);
            if (JSON.stringify(fresh) !== JSON.stringify(contexts)) {
                const ctxDiv = document.getElementById('tw-ctx-btns');
                if (ctxDiv) ctxDiv.innerHTML = buildCtxBtns(getState(), fresh);
                _applyState(getState());
            }
        });
    }

    async function fetchContexts() {
        try {
            const r = await fetch('/api/contexts');
            const d = await r.json();
            return d.success ? d.contexts : [];
        } catch { return []; }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
