// The override phrases found in an instruction text, in the order the server lists them (GET /api/instructions). The server is the one that
// decides on a run; this only lets the panel say, as you type, that the agent will be steered.
export const overridesIn = (text, phrases) => {
  const t = String(text || "").toLowerCase();
  return (Array.isArray(phrases) ? phrases : []).filter((p) => t.includes(p));
};
