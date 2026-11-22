// Job conditions that make a site hotter than the forecast's heat index, which assumes
// shade and light work. Added in °F to the heat index.
// The full-sun value follows OSHA's note that direct sun can add up to 15°F. The workload
// and clothing values are prototype assumptions and need occupational health review.
export const JOB_CONDITIONS = {
  sun: { shade: 0, partial: 7, full: 15 },
  workload: { light: 0, moderate: 3, heavy: 5 },
  clothing: { normal: 0, heavy: 10 },
};

export function conditionAdjustment(conditions = {}) {
  return Object.entries(JOB_CONDITIONS).reduce((sum, [key, options]) => sum + (options[conditions[key]] ?? 0), 0);
}
