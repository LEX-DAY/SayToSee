type DeviceMenuOptions = { label: string };
export type DeviceMenu = { refresh: () => void; destroy: () => void };

let nextMenuId = 0;

/** A small shared control: the native select keeps the existing device-switch contract. */
export function enhanceDeviceSelect(select: HTMLSelectElement, { label }: DeviceMenuOptions): DeviceMenu {
  const wrapper = document.createElement("div");
  wrapper.className = "device-combobox";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "device-trigger";
  trigger.dataset.deviceTrigger = "";
  trigger.dataset.deviceSelectId = select.id;
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-label", label);
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const caption = document.createElement("span");
  caption.className = "device-trigger-text";
  const chevron = document.createElement("span");
  chevron.className = "device-chevron";
  chevron.setAttribute("aria-hidden", "true");
  trigger.append(caption, chevron);
  wrapper.append(trigger);
  select.after(wrapper);

  const popup = document.createElement("div");
  popup.id = `device-menu-${++nextMenuId}`;
  popup.className = "device-menu";
  popup.setAttribute("role", "listbox");
  popup.setAttribute("aria-label", label);
  trigger.setAttribute("aria-controls", popup.id);
  const supportsPopover = typeof popup.showPopover === "function";
  if (supportsPopover) popup.setAttribute("popover", "manual");
  else popup.hidden = true;
  // Keep the popup in the dialog's DOM subtree; the popover top layer avoids clipping.
  const dialog = select.closest("dialog");
  (dialog ?? document.body).append(popup);

  const previousHidden = select.hidden;
  const previousTabIndex = select.getAttribute("tabindex");
  const previousAriaHidden = select.getAttribute("aria-hidden");
  select.hidden = true;
  select.classList.add("native-device-select");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  let options: HTMLOptionElement[] = [];
  let activeIndex = -1;
  let opened = false;
  let destroyed = false;
  let search = "";
  let searchTimer = 0;
  let positionFrame = 0;
  let restoreAfterBusy = false;

  function highlight(index: number) {
    if (!options.length) return;
    activeIndex = Math.max(0, Math.min(index, options.length - 1));
    const rows = popup.querySelectorAll<HTMLElement>("[role=option]");
    rows.forEach((row, i) => row.classList.toggle("is-active", i === activeIndex));
    const active = rows[activeIndex];
    if (active) {
      trigger.setAttribute("aria-activedescendant", active.id);
      // Scroll just the list, never a dialog or the scroll-free page behind it.
      const row = active.getBoundingClientRect();
      const menu = popup.getBoundingClientRect();
      if (row.top < menu.top + 5 || row.height > popup.clientHeight - 10) {
        popup.scrollTop += row.top - menu.top - 5;
      } else if (row.bottom > menu.bottom - 5) {
        popup.scrollTop += row.bottom - menu.bottom + 5;
      }
    }
  }

  function position() {
    positionFrame = 0;
    if (!opened || destroyed) return;
    const rect = trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const edge = 10;
    const overlap = 1;
    // A dropdown is the continuation of its field, never a wider floating card.
    const width = Math.max(0, Math.min(rect.width, viewportWidth - edge * 2));
    popup.style.width = `${width}px`;
    const left = Math.max(viewportLeft + edge, Math.min(rect.left, viewportLeft + viewportWidth - width - edge));
    popup.style.left = `${left}px`;
    const below = Math.max(0, viewportTop + viewportHeight - rect.bottom - edge + overlap);
    const above = Math.max(0, rect.top - viewportTop - edge + overlap);
    const preferredHeight = Math.min(264, popup.scrollHeight + 1);
    const opensAbove = below < preferredHeight && above > below;
    const maxHeight = Math.min(264, opensAbove ? above : below);
    popup.style.maxHeight = `${maxHeight}px`;
    const height = Math.min(popup.scrollHeight + 1, maxHeight);
    popup.style.top = `${opensAbove ? rect.top + overlap - height : rect.bottom - overlap}px`;
    popup.dataset.side = opensAbove ? "top" : "bottom";
    wrapper.dataset.side = popup.dataset.side;
  }

  function schedulePosition() {
    if (!positionFrame && opened) positionFrame = requestAnimationFrame(position);
  }

  function close(restoreFocus = false) {
    if (!opened) return;
    opened = false;
    if (supportsPopover && popup.matches(":popover-open")) popup.hidePopover();
    else if (!supportsPopover) popup.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant");
    wrapper.classList.remove("is-open");
    delete wrapper.dataset.side;
    document.removeEventListener("pointerdown", onOutsidePointer, true);
    window.removeEventListener("resize", schedulePosition);
    window.removeEventListener("scroll", schedulePosition, true);
    window.visualViewport?.removeEventListener("resize", schedulePosition);
    window.visualViewport?.removeEventListener("scroll", schedulePosition);
    if (positionFrame) cancelAnimationFrame(positionFrame);
    positionFrame = 0;
    if (restoreFocus && !trigger.disabled && trigger.isConnected) trigger.focus();
  }

  function refresh() {
    if (destroyed) return;
    const activeValue = options[activeIndex]?.value;
    options = Array.from(select.options).filter((option) => !option.hidden);
    const selected = options.find((option) => option.value === select.value);
    caption.textContent = selected?.textContent || "По умолчанию";
    trigger.title = selected?.textContent || label;
    if (select.disabled && document.activeElement === trigger) restoreAfterBusy = true;
    trigger.disabled = select.disabled;
    if (trigger.disabled) close();
    popup.replaceChildren(...options.map((option, index) => {
      const row = document.createElement("div");
      row.className = "device-menu-option";
      row.id = `${popup.id}-option-${index}`;
      row.dataset.value = option.value;
      row.dataset.index = String(index);
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(option.value === select.value));
      if (option.disabled) row.setAttribute("aria-disabled", "true");
      const text = document.createElement("span");
      text.className = "device-option-text";
      text.textContent = option.textContent;
      const check = document.createElement("span");
      check.className = "device-option-check";
      check.setAttribute("aria-hidden", "true");
      row.append(text, check);
      return row;
    }));
    activeIndex = opened && activeValue !== undefined
      ? options.findIndex((option) => option.value === activeValue)
      : options.findIndex((option) => option.value === select.value);
    if (activeIndex < 0) activeIndex = 0;
    if (opened) { position(); highlight(activeIndex); }
    if (!trigger.disabled && restoreAfterBusy) {
      restoreAfterBusy = false;
      // Disabling a focused button during an async hardware switch blurs it.
      // Restore keyboard position only if the user has not focused another control.
      if ((!dialog || dialog.open) && (document.activeElement === document.body || document.activeElement === dialog)) {
        trigger.focus();
      }
    }
  }

  function open() {
    if (opened || trigger.disabled || destroyed) return;
    refresh();
    opened = true;
    if (supportsPopover) popup.showPopover();
    else popup.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    wrapper.classList.add("is-open");
    position();
    highlight(activeIndex);
    document.addEventListener("pointerdown", onOutsidePointer, true);
    window.addEventListener("resize", schedulePosition);
    window.addEventListener("scroll", schedulePosition, true);
    window.visualViewport?.addEventListener("resize", schedulePosition);
    window.visualViewport?.addEventListener("scroll", schedulePosition);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled || select.disabled) return;
    const changed = select.value !== option.value;
    select.value = option.value;
    close(true);
    refresh();
    if (changed) select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function move(step: number) {
    for (let index = activeIndex + step; index >= 0 && index < options.length; index += step) {
      if (!options[index].disabled) { highlight(index); return; }
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape"].includes(event.key)) {
      if (event.key === "Escape") {
        if (opened) { event.preventDefault(); event.stopPropagation(); close(true); }
        return;
      }
      event.preventDefault();
      const wasOpen = opened;
      open();
      if (event.key === "ArrowDown" && wasOpen) move(1);
      else if (event.key === "ArrowUp" && wasOpen) move(-1);
      else if (event.key === "Home") { activeIndex = -1; move(1); }
      else if (event.key === "End") { activeIndex = options.length; move(-1); }
      else if ((event.key === "Enter" || event.key === " ") && wasOpen) choose(activeIndex);
      return;
    }
    if (event.key === "Tab") { close(); return; }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      open();
      clearTimeout(searchTimer);
      search += event.key.toLocaleLowerCase();
      searchTimer = window.setTimeout(() => { search = ""; }, 600);
      const start = activeIndex + 1;
      for (let offset = 0; offset < options.length; offset++) {
        const index = (start + offset) % options.length;
        if (!options[index].disabled && options[index].textContent?.trim().toLocaleLowerCase().startsWith(search)) {
          highlight(index); break;
        }
      }
    }
  }

  function onOutsidePointer(event: PointerEvent) {
    if (event.target instanceof Node && !wrapper.contains(event.target) && !popup.contains(event.target)) close();
  }
  function onTriggerClick() { if (opened) close(); else open(); }
  function onTriggerFocus() { select.dispatchEvent(new Event("focus")); }
  function onTriggerBlur() { close(); }
  function onOptionPointerDown(event: PointerEvent) { event.preventDefault(); }
  function onOptionPointerMove(event: PointerEvent) {
    const row = (event.target as Element).closest<HTMLElement>("[data-index]");
    if (row && !options[Number(row.dataset.index)]?.disabled) highlight(Number(row.dataset.index));
  }
  function onOptionClick(event: MouseEvent) {
    const row = (event.target as Element).closest<HTMLElement>("[data-index]");
    if (row) choose(Number(row.dataset.index));
  }
  function onDialogClose() { close(); }

  trigger.addEventListener("click", onTriggerClick);
  trigger.addEventListener("keydown", onKeyDown);
  trigger.addEventListener("focus", onTriggerFocus);
  trigger.addEventListener("blur", onTriggerBlur);
  popup.addEventListener("pointerdown", onOptionPointerDown);
  popup.addEventListener("pointermove", onOptionPointerMove);
  popup.addEventListener("click", onOptionClick);
  select.addEventListener("change", refresh);
  dialog?.addEventListener("close", onDialogClose);
  const observer = new MutationObserver(refresh);
  observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "selected", "label", "value"] });
  refresh();
  return {
    refresh,
    destroy() {
      close();
      destroyed = true;
      observer.disconnect();
      clearTimeout(searchTimer);
      select.removeEventListener("change", refresh);
      dialog?.removeEventListener("close", onDialogClose);
      wrapper.remove();
      popup.remove();
      select.hidden = previousHidden;
      select.classList.remove("native-device-select");
      if (previousTabIndex === null) select.removeAttribute("tabindex");
      else select.setAttribute("tabindex", previousTabIndex);
      if (previousAriaHidden === null) select.removeAttribute("aria-hidden");
      else select.setAttribute("aria-hidden", previousAriaHidden);
    },
  };
}
