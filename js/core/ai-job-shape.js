// js/core/ai-job-shape.js — defensive shape validation for
// api/veriqo-estimate.js / api/veriqo-job.js responses.
//
// The server already validates AI output before returning it (JSON.parse
// with a catch, array checks, etc.) — this is a second, independent check
// on the client so a malformed/truncated HTTP response, a proxy error page,
// or a future backend change can never reach the render code and throw.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.Veriqo = root.Veriqo || {};
    var api = factory();
    root.Veriqo.isValidJobShape = api.isValidJobShape;
    root.Veriqo.sanitizePostJobActuals = api.sanitizePostJobActuals;
  }
})(typeof window !== 'undefined' ? window : this, function () {
  function isValidJobShape(job) {
    if (!job || typeof job !== 'object') return false;
    if (typeof job.id !== 'string' || !job.id) return false;
    if (!Array.isArray(job.post_job_actuals)) return false;
    return job.post_job_actuals.every(function (ing) {
      return ing && typeof ing.ingredient_name === 'string';
    });
  }

  // Coerces estimated_portion_cost_pence to a safe finite number for every
  // slot, so a single malformed entry (NaN, string, missing field) can't
  // corrupt a cost total computed by summing the array.
  function sanitizePostJobActuals(actuals) {
    if (!Array.isArray(actuals)) return [];
    return actuals.map(function (ing) {
      var cost = Number(ing && ing.estimated_portion_cost_pence);
      return Object.assign({}, ing, { estimated_portion_cost_pence: isFinite(cost) ? cost : 0 });
    });
  }

  return { isValidJobShape: isValidJobShape, sanitizePostJobActuals: sanitizePostJobActuals };
});
