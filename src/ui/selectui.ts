/**
 * Replaces the native select popup, which the operating system draws and CSS
 * cannot reach. The original select stays in the DOM, hidden, so `.value` and
 * form submission keep working exactly as before and nothing else has to
 * change; this only takes over the presentation and the keyboard handling.
 */
export const SELECT_UI = String.raw`
(function () {
  function enhance(sel) {
    if (sel.dataset.enhanced || sel.multiple) return;
    sel.dataset.enhanced = '1';

    var wrap = document.createElement('div');
    wrap.className = 'sel';
    if (sel.classList.contains('grow')) wrap.classList.add('grow');
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'sel-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    var label = document.createElement('span');
    var caret = document.createElement('span');
    caret.className = 'sel-caret';
    trigger.appendChild(label);
    trigger.appendChild(caret);

    var list = document.createElement('ul');
    list.className = 'sel-list';
    list.setAttribute('role', 'listbox');
    list.tabIndex = -1;

    var opts = [].slice.call(sel.options);
    var items = opts.map(function (o, i) {
      var li = document.createElement('li');
      li.className = 'sel-opt';
      li.setAttribute('role', 'option');
      li.textContent = o.textContent;
      li.dataset.index = String(i);
      list.appendChild(li);
      return li;
    });

    wrap.appendChild(trigger);
    wrap.appendChild(list);

    var active = sel.selectedIndex < 0 ? 0 : sel.selectedIndex;

    function paint() {
      label.textContent = opts[sel.selectedIndex] ? opts[sel.selectedIndex].textContent : '';
      items.forEach(function (li, i) {
        li.setAttribute('aria-selected', i === sel.selectedIndex ? 'true' : 'false');
        li.classList.toggle('active', i === active);
      });
    }

    function open() {
      if (wrap.classList.contains('open')) return;
      // Flip upward when there is not enough room below.
      var below = innerHeight - trigger.getBoundingClientRect().bottom;
      wrap.classList.toggle('up', below < Math.min(264, items.length * 40 + 16) + 16);
      wrap.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      active = sel.selectedIndex < 0 ? 0 : sel.selectedIndex;
      paint();
      if (items[active]) items[active].scrollIntoView({ block: 'nearest' });
    }

    function close() {
      wrap.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }

    function pick(i) {
      if (i < 0 || i >= opts.length) return;
      sel.selectedIndex = i;
      active = i;
      paint();
      // Anything listening to the original select still hears about it.
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      close();
      trigger.focus();
    }

    function move(delta) {
      active = Math.max(0, Math.min(opts.length - 1, active + delta));
      paint();
      if (items[active]) items[active].scrollIntoView({ block: 'nearest' });
    }

    trigger.addEventListener('click', function () {
      wrap.classList.contains('open') ? close() : open();
    });

    list.addEventListener('click', function (e) {
      var li = e.target.closest('.sel-opt');
      if (li) pick(Number(li.dataset.index));
    });

    list.addEventListener('mousemove', function (e) {
      var li = e.target.closest('.sel-opt');
      if (!li) return;
      active = Number(li.dataset.index);
      paint();
    });

    trigger.addEventListener('keydown', function (e) {
      var isOpen = wrap.classList.contains('open');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isOpen) { open(); return; }
        move(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        isOpen ? pick(active) : open();
      } else if (e.key === 'Escape') {
        if (isOpen) { e.preventDefault(); close(); }
      } else if (e.key === 'Home') { e.preventDefault(); active = 0; paint(); }
      else if (e.key === 'End') { e.preventDefault(); active = opts.length - 1; paint(); }
      else if (e.key.length === 1) {
        // Type the first letter to jump, the way a real select does.
        var ch = e.key.toLowerCase();
        for (var i = 1; i <= opts.length; i++) {
          var j = (active + i) % opts.length;
          if ((opts[j].textContent || '').trim().toLowerCase().indexOf(ch) === 0) {
            active = j; paint();
            if (isOpen && items[j]) items[j].scrollIntoView({ block: 'nearest' });
            else pick(j);
            break;
          }
        }
      }
    });

    document.addEventListener('pointerdown', function (e) {
      if (!wrap.contains(e.target)) close();
    });

    paint();
  }

  function run() { document.querySelectorAll('select').forEach(enhance); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
`;
