// GB/T 20481-2017《气象干旱等级》土壤相对湿度分级，与服务端 soil.mjs 的分级保持一致。
// R = 体积含水量 ÷ 田间持水量 × 100%；R>90 过湿，60–90 适宜，50–60 轻旱，40–50 中旱，30–40 重旱，<30 特旱。
export const soilGradeMeta = {
  waterlogged: { label: "过湿", range: "R > 90%", color: "#4da3ff", text: "#9cd0ff", bg: "rgba(77,163,255,.14)", border: "rgba(77,163,255,.5)" },
  suitable: { label: "适宜", range: "60–90%", color: "#58c98a", text: "#9fe3bd", bg: "rgba(88,201,138,.14)", border: "rgba(88,201,138,.5)" },
  mild: { label: "轻旱", range: "50–60%", color: "#e8c95c", text: "#f4dd8d", bg: "rgba(232,201,92,.14)", border: "rgba(232,201,92,.5)" },
  moderate: { label: "中旱", range: "40–50%", color: "#f0954a", text: "#ffb98a", bg: "rgba(240,149,74,.15)", border: "rgba(240,149,74,.55)" },
  severe: { label: "重旱", range: "30–40%", color: "#ef6a5a", text: "#ffab9f", bg: "rgba(239,106,90,.15)", border: "rgba(239,106,90,.55)" },
  extreme: { label: "特旱", range: "R < 30%", color: "#c04a78", text: "#eaa0c4", bg: "rgba(192,74,120,.16)", border: "rgba(192,74,120,.55)" },
};

export const soilGradeScale = ["waterlogged", "suitable", "mild", "moderate", "severe", "extreme"]
  .map((id) => ({ id, ...soilGradeMeta[id] }));

export function gradeOf(grade) {
  return soilGradeMeta[grade] ?? null;
}
