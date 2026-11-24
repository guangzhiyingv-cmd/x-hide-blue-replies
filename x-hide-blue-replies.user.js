// ==UserScript==
// @name         X 隐藏蓝 V 回复
// @namespace    x-hide-blue-replies
// @version      1.4.0
// @description  在 X 的时间线和推文详情页快捷关注、取消关注或屏蔽作者，并过滤蓝 V 回复。
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://www.x.com/*
// @match        https://www.twitter.com/*
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        unsafeWindow
// @noframes
// ==/UserScript==

(() => {
    'use strict';

    const statusPath = /^\/(\w+|i\/web)\/status\/(\d+)\/?$/;
    const profilePath = /^\/(\w{1,15})\/?$/;
    const primaryColumnSelector = '[data-testid="primaryColumn"]';
    const tweetSelector = 'article[data-testid="tweet"]';
    const authorSelector = '[data-testid="User-Name"]';
    const timeLinkSelector = 'a[href*="/status/"]:has(time)';
    const cellSelector = '[data-testid="cellInnerDiv"]';
    const quoteSelector = '[data-testid="quoteTweet"], [role="link"]:not(a)';
    const headingSelector = 'h2, [role="heading"][aria-level="2"]';
    const replyButtonSelector = '[data-testid="reply"]';
    const hiddenAttribute = 'data-x-hide-blue-reply';
    const blueFills = new Set(['rgb(29,155,240)', 'rgb(29,161,242)', '#1d9bf0', '#1da1f2']);
    const caretSelector = '[data-testid="caret"]';
    const menuSelector = '#layers :is([data-testid="Dropdown"], [data-testid="sheetDialog"])';
    const dialogSelector = '[data-testid="confirmationSheetDialog"], [role="alertdialog"], [role="dialog"]';
    const confirmSelector = '#layers [data-testid="confirmationSheetConfirm"]';
    const quickGroupClass = 'xqr-quick-actions';
    const quickControls = new WeakMap();
    const personIcon = '<circle cx="9" cy="7" r="3"/><path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2"/>';
    const actions = {
        follow: {
            type: 'follow', label: '关注', icon: `${personIcon}<path d="M18 7v6m-3-3h6"/>`,
            menuLabel: /^(?:follow|关注|關注|跟隨|追蹤|seguir|suivre|folgen|팔로우|подписаться на)\s*@\w{1,15}$|^@\w{1,15}\s*(?:をフォロー(?:する)?|さんをフォロー(?:する)?|folgen)$/iu,
        },
        unfollow: {
            type: 'unfollow', label: '取消关注', icon: `${personIcon}<path d="m16 10 2 2 4-4"/>`,
            menuLabel: /^(?:unfollow|取消关注|取消關注|取消跟隨|取消追蹤|dejar de seguir|ne plus suivre|entfolgen|팔로우 취소|отписаться от)\s*@\w{1,15}$|^@\w{1,15}\s*(?:をフォロー解除(?:する)?|さんのフォローを解除(?:する)?|さんをフォロー解除(?:する)?|entfolgen)$/iu,
            confirmLabel: /^(?:unfollow|取消关注|取消關注|取消跟隨|取消追蹤|フォロー解除|팔로우 취소|dejar de seguir|ne plus suivre|entfolgen|отписаться)$/iu,
        },
        block: {
            type: 'block', label: '屏蔽', icon: '<circle cx="12" cy="12" r="8.5"/><path d="m6 18 12-12"/>',
            confirmLabel: /^(?:block|屏蔽|封鎖|封锁|阻止|拉黑|ブロック|차단|bloquear|bloquer|blockieren|blocca|blokkeren|заблокировать|engelle|حظر|ब्लॉक करें)$/iu,
        },
    };
    const menuFollowing = new Map();
    let viewerHandle;
    let relationshipStore;
    let stopWatchingRelationships;
    let sessionUserId;
    let userEntities;
    let siteFollowing = new Map();

    const style = document.createElement('style');
    style.textContent = `
        [${hiddenAttribute}] { display: none !important; }
        .xqr-quick-actions { display: inline-flex; flex: none; align-items: center; gap: 2px; margin-inline-end: 3px; }
        .xqr-quick-button {
            appearance: none; box-sizing: border-box; display: inline-grid; place-items: center;
            width: 30px; height: 30px; padding: 0; border: 0; border-radius: 50%;
            background: transparent; color: inherit; cursor: pointer; --xqr-accent: #1d9bf0;
            --xqr-hover: rgb(29 155 240 / 12%); transition: color 120ms ease, background-color 120ms ease;
        }
        .xqr-quick-button[data-action="block"] { --xqr-accent: #f4212e; --xqr-hover: rgb(244 33 46 / 12%); }
        .xqr-quick-button[data-action="unfollow"] { color: #1d9bf0; --xqr-accent: #f4212e; --xqr-hover: rgb(244 33 46 / 12%); }
        .xqr-quick-button:not(:disabled):is(:hover, :focus-visible) { color: var(--xqr-accent); background: var(--xqr-hover); }
        .xqr-quick-button:focus-visible { outline: 2px solid var(--xqr-accent); outline-offset: 1px; }
        .xqr-quick-button:disabled { opacity: .45; cursor: progress; }
        .xqr-quick-button svg { width: 18px; height: 18px; pointer-events: none; }
        .xqr-quick-notice {
            position: fixed; z-index: 10000; inset-inline-start: 50%; inset-block-end: max(24px, env(safe-area-inset-bottom));
            transform: translateX(-50%); max-width: calc(100vw - 32px); box-sizing: border-box; width: max-content;
            background: #0b6aa8; color: #fff; font: 600 14px/1.45 system-ui, sans-serif;
            border-radius: 16px; padding: 10px 16px; box-shadow: 0 4px 18px rgb(0 0 0 / 20%); pointer-events: none;
        }
        @media (max-width: 480px) {
            .xqr-quick-actions { gap: 0; margin-inline-end: 1px; }
            .xqr-quick-button { width: 27px; height: 30px; }
            .xqr-quick-button svg { width: 16px; height: 16px; }
        }
        @media (prefers-reduced-motion: reduce) { .xqr-quick-button { transition: none; } }
    `;
    document.head.append(style);

    let currentPath;
    let thread;
    let hidden = new Set();
    let frame = 0;
    let quickActionPending = false;
    let quickNotice;
    let noticeTimer;

    function getAuthor(tweet) {
        const author = tweet.querySelector(authorSelector);
        if (author?.closest(tweetSelector) === tweet && !author.closest(quoteSelector)) return author;
    }

    function getStatusHandle(status) {
        const handle = status?.[1].toLowerCase();
        if (handle !== 'i' && handle !== 'i/web') return handle;
    }

    function getAuthorHandle(author) {
        if (!author) return;
        for (const link of author.querySelectorAll('a[href]')) {
            const handle = profilePath.exec(link.pathname)?.[1];
            if (handle) return handle.toLowerCase();
        }
        const timeLink = author.querySelector(timeLinkSelector);
        if (timeLink) return getStatusHandle(statusPath.exec(timeLink.pathname));
    }

    function getTweetStatus(tweet) {
        const authorTime = getAuthor(tweet)?.querySelector(timeLinkSelector);
        if (authorTime) return statusPath.exec(authorTime.pathname);

        // X 有时把详情页主推文的时间链接放在作者栏下方。
        if (tweet.getAttribute('tabindex') !== '-1') return;
        for (const link of tweet.querySelectorAll(timeLinkSelector)) {
            if (link.closest(tweetSelector) === tweet && !link.closest(quoteSelector)) {
                const status = statusPath.exec(link.pathname);
                if (status) return status;
            }
        }
    }

    function visibleElements(selector) {
        return Array.from(document.querySelectorAll(selector))
            .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
    }

    function waitForElement(find) {
        const existing = find();
        if (existing) return Promise.resolve(existing);

        return new Promise(resolve => {
            const observer = new MutationObserver(() => {
                const element = find();
                if (element) finish(element);
            });
            const timer = setTimeout(() => finish(), 2500);
            function finish(element) {
                observer.disconnect();
                clearTimeout(timer);
                resolve(element);
            }
            observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
        });
    }

    function showQuickNotice(message) {
        if (!quickNotice?.isConnected) {
            quickNotice = document.createElement('div');
            quickNotice.className = 'xqr-quick-notice';
            quickNotice.setAttribute('role', 'status');
            document.body.append(quickNotice);
        }
        quickNotice.textContent = message;
        clearTimeout(noticeTimer);
        noticeTimer = setTimeout(() => quickNotice.remove(), 3200);
    }

    function actionText(element) {
        return (element.textContent.trim() || element.getAttribute('aria-label') || '').normalize('NFKC')
            .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
    }

    function mentionsHandle(label, handle) {
        return Array.from(label.matchAll(/@(\w{1,15})(?!\w)/g)).some(match => match[1].toLowerCase() === handle);
    }

    function syncFollowingState() {
        // 只读取 X 已经载入的关注状态，实际操作仍通过该推文的菜单执行。
        const page = typeof unsafeWindow === 'undefined' ? document : unsafeWindow.document;
        const app = page.querySelector('#react-root')?.firstElementChild;
        const key = app && Object.keys(app).find(name => name.startsWith('__reactProps$'));
        const store = key && app[key]?.children?.props?.children?.props?.store;
        if (store !== relationshipStore) {
            stopWatchingRelationships?.();
            relationshipStore = store;
            stopWatchingRelationships = store?.subscribe?.(() => {
                const next = store.getState();
                if (next?.session?.user_id !== sessionUserId || next?.entities?.users?.entities !== userEntities) scheduleRefresh();
            });
        }
        const state = store?.getState?.();
        sessionUserId = state?.session?.user_id;
        const users = state?.entities?.users?.entities;
        const profile = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
        const viewer = users?.[sessionUserId]?.screen_name?.toLowerCase() ??
            profilePath.exec(profile?.pathname || '')?.[1].toLowerCase();
        if (viewer !== viewerHandle) {
            viewerHandle = viewer;
            menuFollowing.clear();
        }
        if (users === userEntities) return;
        userEntities = users;
        siteFollowing = new Map();
        for (const user of Object.values(users || {})) {
            if (typeof user?.following === 'boolean' && typeof user.screen_name === 'string') {
                siteFollowing.set(user.screen_name.toLowerCase(), user.following);
            }
        }
    }

    function isFollowing(handle) {
        const actual = siteFollowing.get(handle);
        const recent = menuFollowing.get(handle);
        if (!recent) return actual;
        if (actual === undefined || actual === recent.previousSiteState) return recent.following;
        menuFollowing.delete(handle);
        return actual;
    }

    function noteFollowing(handle, following, verifiedInMenu = false) {
        const previousSiteState = siteFollowing.get(handle);
        if (verifiedInMenu || previousSiteState === undefined) menuFollowing.set(handle, { following, previousSiteState });
        else menuFollowing.delete(handle);
        scheduleRefresh();
    }

    function findQuickMenuItem(menu, action, handle) {
        const { type } = action;
        const testIds = `[data-testid="${type}"], [data-testid="${type}Link"], [data-testid="${handle}-${type}" i]`;
        for (const element of menu.querySelectorAll(`${testIds}, [role="menuitem"]`)) {
            const item = element.closest('[role="menuitem"]') || element;
            const label = actionText(item);
            const nativeId = element.getAttribute('data-testid')?.toLowerCase();
            if (nativeId === `${handle}-${type}`) return item;
            if (!mentionsHandle(label, handle)) continue;
            if (element.matches(testIds) || item.querySelector(testIds)) return item;
            if (action.menuLabel?.test(label)) return item;
        }
    }

    function findActionConfirmation(action, handle) {
        const buttons = visibleElements(confirmSelector);
        if (buttons.length !== 1) return;
        const [button] = buttons;
        const dialog = button.closest(dialogSelector);
        const heading = dialog?.querySelector('[role="heading"], h1, h2');
        if (!dialog || !action.confirmLabel.test(actionText(button))) return;
        const title = heading && actionText(heading);
        if (mentionsHandle(title?.includes('@') ? title : actionText(dialog), handle)) return button;
    }

    async function runQuickAction(event, tweet, controls, action) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.isTrusted || quickActionPending) return;
        const { group, caret, handle } = controls;
        const path = location.pathname;
        const viewer = viewerHandle;
        const isCurrent = () => location.pathname === path && viewerHandle === viewer && group.isConnected && caret.isConnected &&
            getAuthorHandle(getAuthor(tweet)) === handle;
        if (!isCurrent()) return;
        if (visibleElements(menuSelector).length || visibleElements(confirmSelector).length) {
            showQuickNotice('请先关闭 X 当前打开的菜单或弹窗');
            return;
        }

        quickActionPending = true;
        const buttons = Array.from(group.querySelectorAll('button'));
        group.setAttribute('aria-busy', 'true');
        buttons.forEach(button => { button.disabled = true; });
        try {
            caret.click();
            const menu = await waitForElement(() => {
                const visibleMenus = visibleElements(menuSelector);
                const menus = visibleMenus.filter(menu => !visibleMenus.some(other => other !== menu && menu.contains(other)));
                return menus.length === 1 ? menus[0] : undefined;
            });
            if (!isCurrent()) return;
            const item = menu && findQuickMenuItem(menu, action, handle);
            if (!item) {
                const inverse = action.type === 'follow' ? actions.unfollow : actions.follow;
                const inverseItem = action.type !== 'block' && menu && findQuickMenuItem(menu, inverse, handle);
                menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                if (inverseItem) {
                    const alreadyFollowing = inverse === actions.unfollow;
                    noteFollowing(handle, alreadyFollowing, true);
                    showQuickNotice(alreadyFollowing ? `已关注 @${handle}` : `尚未关注 @${handle}`);
                    return;
                }
                showQuickNotice(`X 菜单里没有「${action.label} @${handle}」选项`);
                return;
            }
            const before = siteFollowing.get(handle);
            item.click();
            if (action === actions.follow) {
                if (!tweet.querySelector('svg[data-testid="icon-lock"]')) noteFollowing(handle, true);
            } else {
                const confirmation = await waitForElement(() => {
                    const button = findActionConfirmation(action, handle);
                    if (button) return { button };
                    if (action === actions.unfollow) {
                        syncFollowingState();
                        if (before === true && siteFollowing.get(handle) === false && !visibleElements(confirmSelector).length) return {};
                    }
                });
                if (!isCurrent()) return;
                if (confirmation?.button) confirmation.button.click();
                else if (action === actions.block || visibleElements(confirmSelector).length) {
                    showQuickNotice(`未找到 @${handle} 的${action.label}确认按钮`);
                    return;
                }
                if (action === actions.unfollow) noteFollowing(handle, false);
                else {
                    menuFollowing.delete(handle);
                    scheduleRefresh();
                }
            }
        } finally {
            buttons.forEach(button => { button.disabled = false; });
            group.removeAttribute('aria-busy');
            quickActionPending = false;
        }
    }

    function getHeaderAnchor(tweet, author, caret) {
        const grok = tweet.querySelector('[data-testid="grokTweet"], button[aria-label*="Grok" i]');
        let fallback;
        for (let anchor = caret; anchor.parentElement && anchor.parentElement !== tweet; anchor = anchor.parentElement) {
            const parent = anchor.parentElement;
            if (grok && parent.contains(grok) && !anchor.contains(grok) && !parent.contains(author)) {
                return Array.from(parent.children).find(child => child.contains(grok));
            }
            const layout = getComputedStyle(parent);
            if (layout.display.includes('flex') && layout.flexDirection.startsWith('row')) {
                fallback = anchor;
            }
            if (parent.contains(author)) break;
        }
        return fallback || caret;
    }

    function renderQuickButton(button, action, handle) {
        if (button.dataset.action === action.type) return;
        button.dataset.action = action.type;
        button.title = `${action.label} @${handle}`;
        button.setAttribute('aria-label', action === actions.unfollow ? `已关注，${button.title}` : button.title);
        button.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${action.icon}</svg>`;
    }

    function syncQuickActions() {
        const column = document.querySelector(primaryColumnSelector);
        if (!column) return;

        syncFollowingState();
        for (const tweet of column.querySelectorAll(tweetSelector)) {
            if (tweet.parentElement.closest(tweetSelector) || tweet.closest(quoteSelector)) continue;
            const author = getAuthor(tweet);
            const handle = getAuthorHandle(author);
            const caret = tweet.querySelector(caretSelector);
            const previous = quickControls.get(tweet);
            const eligible = handle && handle !== viewerHandle && caret?.closest(tweetSelector) === tweet && !caret.closest(quoteSelector);
            if (!eligible) {
                previous?.group.remove();
                continue;
            }
            const followAction = isFollowing(handle) ? actions.unfollow : actions.follow;
            if (previous && tweet.contains(previous.group) && previous.caret === caret && previous.handle === handle) {
                renderQuickButton(previous.group.firstElementChild, followAction, handle);
                continue;
            }
            previous?.group.remove();

            const group = document.createElement('div');
            group.className = quickGroupClass;
            group.setAttribute('role', 'group');
            group.setAttribute('aria-label', `@${handle} 的快捷操作`);
            group.style.color = getComputedStyle(caret.querySelector('svg') || caret).color;
            const controls = { group, caret, handle };
            for (const action of [followAction, actions.block]) {
                const button = document.createElement('button');
                button.className = 'xqr-quick-button';
                button.type = 'button';
                renderQuickButton(button, action, handle);
                button.addEventListener('click', event => runQuickAction(event, tweet, controls, actions[button.dataset.action]));
                button.addEventListener('keydown', event => {
                    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
                });
                group.append(button);
            }
            getHeaderAnchor(tweet, author, caret).before(group);
            quickControls.set(tweet, controls);
        }
    }

    function hasBlueBadge(author) {
        if (!author) return false;

        for (const badge of author.querySelectorAll('svg[data-testid="icon-verified"]')) {
            // 金 V 徽章可以使用 SVG 渐变，蓝 V 使用纯色填充。
            if (badge.querySelector('linearGradient, radialGradient')) continue;
            for (const shape of badge.querySelectorAll('path, use')) {
                const fill = getComputedStyle(shape).fill.toLowerCase().replace(/\s/g, '');
                if (blueFills.has(fill)) return true;
            }
        }
        return false;
    }

    function isPositiveCount(text) {
        const digits = text?.normalize('NFKC').match(/\p{Decimal_Number}/gu);
        if (!digits) return undefined;

        return digits.some(digit => {
            // Unicode 十进制数字以每组 0 到 9 的顺序排列。
            const code = digit.codePointAt(0);
            let firstDigit = code;
            while (/\p{Decimal_Number}/u.test(String.fromCodePoint(firstDigit - 1))) firstDigit--;
            return (code - firstDigit) % 10 !== 0;
        });
    }

    function hasReplies(tweet) {
        const button = Array.from(tweet.querySelectorAll(replyButtonSelector))
            .find(button => button.closest(tweetSelector) === tweet && !button.closest(quoteSelector));
        if (!button) return false;

        // 优先读取无障碍标签，避免数字滚动动画同时显示旧值和新值。
        return isPositiveCount(button.getAttribute('aria-label')) ?? isPositiveCount(button.textContent) ?? false;
    }

    function rowOffset(row) {
        const offset = row.style.transform.match(/translateY\((-?\d+(?:\.\d+)?)px\)/);
        return offset ? Number(offset[1]) : undefined;
    }

    function collectBlueReplies() {
        const path = location.pathname;
        if (path !== currentPath) {
            currentPath = path;
            thread = undefined;
        }

        const result = new Set();
        const currentStatus = statusPath.exec(path);
        const column = currentStatus && document.querySelector(primaryColumnSelector);
        if (!column) return result;

        const mainTweet = Array.from(column.querySelectorAll(tweetSelector))
            .find(tweet => getTweetStatus(tweet)?.[2] === currentStatus[2] && !tweet.closest(quoteSelector));
        const mainRow = mainTweet?.closest(cellSelector);
        if (mainRow) {
            const timeline = mainRow.parentElement;
            if (thread?.timeline !== timeline) thread = { timeline };
            thread.mainOffset = rowOffset(mainRow);
            thread.mainAuthor = getAuthorHandle(getAuthor(mainTweet)) ?? getStatusHandle(getTweetStatus(mainTweet)) ??
                getStatusHandle(currentStatus) ?? thread.mainAuthor;
        }
        if (!thread || !column.contains(thread.timeline)) return result;

        // X 滚动时可能卸载主推文。主推文离开 DOM 后，用列表的纵向偏移定位回复区。
        const rows = Array.from(thread.timeline.children);
        const mainIndex = rows.indexOf(mainRow);
        const start = mainIndex >= 0 ? mainIndex + 1 : rows.findIndex(row => rowOffset(row) > thread.mainOffset);
        if (start < 0) return result;

        // 推荐内容另有标题行。遇到新分区时结束，以免隐藏推荐推文。
        const end = rows.findIndex((row, index) => index >= start &&
            !row.querySelector(tweetSelector) && (row.matches(headingSelector) || row.querySelector(headingSelector)));
        if (end >= 0) thread.endOffset = rowOffset(rows[end]);

        for (const row of rows.slice(start, end < 0 ? rows.length : end)) {
            if (!row.matches(cellSelector)) continue;
            if (end < 0 && rowOffset(row) >= thread.endOffset) continue;

            const tweets = Array.from(row.querySelectorAll(tweetSelector))
                .filter(tweet => !tweet.parentElement.closest(tweetSelector) && !tweet.closest(quoteSelector));
            for (const tweet of tweets) {
                const author = getAuthor(tweet);
                if (tweet === mainTweet || !hasBlueBadge(author)) continue;
                if (keepAuthorReplies() && thread.mainAuthor && getAuthorHandle(author) === thread.mainAuthor) continue;
                if (keepRepliedTo() && hasReplies(tweet)) continue;
                // 隐藏内容并保留外层定位节点，交给 X 重新计算行高。
                const content = row.firstElementChild;
                const target = tweets.length === 1 && content?.contains(tweet) ? content : tweet;
                result.add(target);
            }
        }
        return result;
    }

    function refresh() {
        frame = 0;
        const next = collectBlueReplies();
        for (const element of hidden) {
            if (!next.has(element)) element.removeAttribute(hiddenAttribute);
        }
        for (const element of next) {
            if (!element.hasAttribute(hiddenAttribute)) element.setAttribute(hiddenAttribute, '');
        }
        hidden = next;
        syncQuickActions();
    }

    function scheduleRefresh() {
        if (!frame) frame = requestAnimationFrame(refresh);
    }

    function registerToggle(key, label) {
        let enabled = GM_getValue(key, false) === true;
        let menuId;

        function updateMenu() {
            if (menuId !== undefined) GM_unregisterMenuCommand(menuId);
            menuId = GM_registerMenuCommand(`${label}：${enabled ? '已开启' : '已关闭'}`, () => {
                GM_setValue(key, !enabled);
            });
        }

        GM_addValueChangeListener(key, (_key, _previousValue, value) => {
            enabled = value === true;
            updateMenu();
            scheduleRefresh();
        });
        updateMenu();
        return () => enabled;
    }

    const keepAuthorReplies = registerToggle('keepThreadAuthorReplies', '保留推主回复');
    const keepRepliedTo = registerToggle('keepRepliedTo', '保留已有回复的评论');

    new MutationObserver(records => {
        const updatedStatusPage = statusPath.test(location.pathname) && records.some(record => {
            if (record.type === 'characterData') {
                return keepRepliedTo() && record.target.parentElement?.closest(replyButtonSelector);
            }
            return record.type === 'childList' || record.attributeName === 'href' ||
                record.target.matches(tweetSelector) || record.target.closest(authorSelector) ||
                (keepRepliedTo() && record.target.matches(replyButtonSelector));
        });
        const updatedTweets = records.some(record =>
            record.type === 'childList' || record.attributeName === 'href' || record.attributeName === 'data-testid');
        if (location.pathname !== currentPath || updatedStatusPage || updatedTweets) {
            scheduleRefresh();
        }
    }).observe(document.documentElement, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'fill', 'color', 'class', 'style', 'tabindex', 'aria-label', 'data-testid'],
    });
    window.navigation?.addEventListener('currententrychange', scheduleRefresh);
    window.addEventListener('popstate', scheduleRefresh);
    window.addEventListener('pageshow', scheduleRefresh);
    scheduleRefresh();
})();
