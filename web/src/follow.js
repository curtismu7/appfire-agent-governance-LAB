// Keep the newest turn in view (owner, 2026-11-16: "make the response scroll so we always see the latest response from the agent").
// Two scrollers matter now that the Agent column is twice as tall as the window's usable height:
//  1. The chat box (the column's own scroller). A newest turn that fits is scrolled fully into view, to the end of the chat; one taller than the
//     box keeps its TOP in view so the reply is read from its start (a hand-off card is kept whole, as before).
//  2. The page. The column can run below the window, so the newest turn is brought into the window the least it takes (block: "nearest": nothing
//     happens when it is already fully visible). `.turn` carries a scroll-margin so it stops above the message box pinned to the window's bottom.
export function followNewest(box, last) {
  if (!box || !last) return;
  if (box.scrollHeight > box.clientHeight) {
    const fits = last.offsetHeight + 16 <= box.clientHeight;
    let to = fits ? box.scrollHeight - box.clientHeight : last.offsetTop - box.offsetTop - 8;
    const card = fits ? null : last.querySelector('[data-testid="handoff-card"]');
    if (card) {
      const b = box.getBoundingClientRect();
      const bottom = card.getBoundingClientRect().bottom - b.top + box.scrollTop + 8;
      to = Math.max(to, bottom - box.clientHeight);
    }
    box.scrollTop = Math.max(0, to);
  }
  last.scrollIntoView?.({ block: "nearest" });
}
