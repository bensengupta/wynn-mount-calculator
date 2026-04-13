// @ts-check

import allIngredients from "./ingredients.json" with { type: "json" };
import GLPKFactory from "https://esm.sh/glpk.js@5.0.0";

/**
 * @typedef {number[]} Stats
 */

const SPEED = 0;
const ACCEL = 1;
const ALTIT = 2;
const ENERG = 3;
const HANDL = 4;
const TOUGH = 5;
const BOOST = 6;
const TRAIN = 7;
const STAT_NAMES = ["Speed", "Acceleration", "Altitude", "Energy", "Handling", "Toughness", "Boost", "Training"];

/**
 * @template {Element} T
 * @param {string} selector
 * @returns {T}
 */
function queryRequired(selector) {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return /** @type {T} */ (element);
}

/**
 * @typedef {{ current: Stats, limit: Stats, max: Stats }} MountInfo
 */

/**
 * @param {Stats} a
 * @param {Stats} b
 * @returns {Stats}
 */
function subtractStats(a, b) {
  return [
    a[0] - b[0],
    a[1] - b[1],
    a[2] - b[2],
    a[3] - b[3],
    a[4] - b[4],
    a[5] - b[5],
    a[6] - b[6],
    a[7] - b[7],
  ];
}

/**
 * @param {number} status
 * @param {import("glpk.js").GLPK} glpk
 * @returns {string}
 */
function serializeGLPKStatus(status, glpk) {
  switch (status) {
    case glpk.GLP_UNDEF:
      return "Undefined";
    case glpk.GLP_FEAS:
      return "Solution found, but not proven optimal";
    case glpk.GLP_INFEAS:
      return "Impossible";
    case glpk.GLP_NOFEAS:
      return "Impossible";
    case glpk.GLP_OPT:
      return "Optimal";
    case glpk.GLP_UNBND:
      return "Unbounded";
    default:
      return `Unknown (${status})`;
  }
}

/**
 * @param {MountInfo} mountInfo
 * @param {{ timeImportance: number, timeLimitSeconds: number }} opts
 */
async function calculateIngredients(mountInfo, opts) {
  const highestCurrentStat = Math.max(...mountInfo.current);
  const target = subtractStats(mountInfo.max, mountInfo.limit);
  const allowedIngredients = allIngredients.filter((ing) => ing.level <= highestCurrentStat);

  /**
   * @type {import("glpk.js").GLPK}
   */
  const glpk = await GLPKFactory();

  const objective = allowedIngredients.map((ing, idx) => ({
    name: `x${idx}`,
    coef: opts.timeImportance * 60 + (1 - opts.timeImportance) * ing.level,
  }));

  const constraints = [];
  for (let i = 0; i < 8; i++) {
    const constraint = {
      name: `constraint_${i}`,
      vars: allowedIngredients
        .map((ing, idx) => ({ name: `x${idx}`, coef: ing.stats[i] }))
        .filter((cons) => cons.coef > 0),
      bnds: { type: glpk.GLP_LO, lb: target[i], ub: 0.0 },
    };
    constraints.push(constraint);
  }

  const bounds = allowedIngredients.map((_, idx) => ({
    name: `x${idx}`,
    type: glpk.GLP_LO,
    lb: 0.0,
    ub: 0.0,
  }));

  const generals = allowedIngredients.map((_, idx) => `x${idx}`);

  /** @type {import("glpk.js").LP} */
  const lp = {
    name: "LP",
    objective: {
      direction: glpk.GLP_MIN,
      name: "obj",
      vars: objective,
    },
    subjectTo: constraints,
    bounds,
    generals,
  };

  const glpkOptions = {
    msglev: glpk.GLP_MSG_ERR,
    presol: true,
    tmlim: opts.timeLimitSeconds,
  };

  const { time, result } = await glpk.solve(lp, glpkOptions);

  const ingredients = Object.entries(result.vars)
    .filter(([_, varValue]) => varValue > 0)
    .map(([varName, varValue]) => {
      const index = parseInt(varName.substring(1));
      return {
        ingredient: allowedIngredients[index],
        quantity: varValue,
      };
    });

  return {
    time,
    status: serializeGLPKStatus(result.status, glpk),
    ingredients,
    totalQuantity: ingredients.reduce((sum, ing) => sum + ing.quantity, 0),
    totalCost: ingredients.reduce((sum, ing) => sum + ing.ingredient.level * ing.quantity, 0),
  };
}

const mountForm = /** @type {HTMLFormElement} */ (queryRequired("#mount-form"));
const statsTableBody = /** @type {HTMLTableSectionElement} */ (queryRequired("#stats-table-body"));
const timeImportanceInput = /** @type {HTMLInputElement} */ (queryRequired("#time-importance"));
const timeImportanceValue = /** @type {HTMLElement} */ (queryRequired("#time-importance-value"));

const runtimeEl = /** @type {HTMLElement} */ (queryRequired("#runtime"));
const solutionStatusEl = /** @type {HTMLElement} */ (queryRequired("#solution-status"));
const totalCostEl = /** @type {HTMLElement} */ (queryRequired("#total-cost"));
const statusEl = /** @type {HTMLElement} */ (queryRequired("#status"));
const ingredientsListEl = /** @type {HTMLUListElement} */ (queryRequired("#ingredients-list"));

const defaultMountInfo = {
  current: [1, 3, 1, 2, 1, 1, 1, 1],
  limit: [10, 10, 10, 10, 10, 10, 10, 10],
  max: [40, 40, 40, 40, 40, 40, 40, 40],
};

for (let i = 0; i < STAT_NAMES.length; i++) {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td>${STAT_NAMES[i]}</td>
    <td><input type="number" min="0" step="1" name="current-${i}" value="${defaultMountInfo.current[i]}"></td>
    <td><input type="number" min="0" step="1" name="limit-${i}" value="${defaultMountInfo.limit[i]}"></td>
    <td><input type="number" min="0" step="1" name="max-${i}" value="${defaultMountInfo.max[i]}"></td>
  `;
  statsTableBody.appendChild(row);
}

function updateTimeImportanceLabel() {
  timeImportanceValue.textContent = Number(timeImportanceInput.value).toFixed(2);
}

/**
 * @param {FormData} formData
 * @param {string} prefix
 * @returns {Stats}
 */
function readStats(formData, prefix) {
  return Array.from({ length: 8 }, (_, i) => {
    const raw = formData.get(`${prefix}-${i}`);
    const value = Number(raw);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  });
}

/**
 * @param {Awaited<ReturnType<typeof calculateIngredients>>} result
 */
function renderResult(result) {
  runtimeEl.textContent = `${result.time.toFixed(3)}s`;
  solutionStatusEl.textContent = result.status;
  totalCostEl.textContent = `${result.totalCost}`;
  statusEl.textContent = `Ingredients selected: ${result.totalQuantity}`;

  ingredientsListEl.innerHTML = "";
  if (result.ingredients.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No ingredients required for this target.";
    ingredientsListEl.appendChild(item);
    return;
  }

  for (const { ingredient, quantity } of result.ingredients) {
    const item = document.createElement("li");
    item.textContent = `${ingredient.name} (Level ${ingredient.level}) × ${quantity}`;
    ingredientsListEl.appendChild(item);
  }
}

updateTimeImportanceLabel();
timeImportanceInput.addEventListener("input", updateTimeImportanceLabel);

mountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "Calculating...";
  ingredientsListEl.innerHTML = "";

  const formData = new FormData(mountForm);

  /** @type {MountInfo} */
  const mountInfo = {
    current: readStats(formData, "current"),
    limit: readStats(formData, "limit"),
    max: readStats(formData, "max"),
  };

  const options = {
    timeImportance: Number(formData.get("timeImportance")) || 0,
    timeLimitSeconds: Math.max(1, Number(formData.get("timeLimitSeconds")) || 1),
  };

  try {
    const result = await calculateIngredients(mountInfo, options);
    renderResult(result);
  } catch (error) {
    runtimeEl.textContent = "-";
    solutionStatusEl.textContent = "Error";
    totalCostEl.textContent = "-";
    statusEl.textContent = error instanceof Error ? error.message : "Unknown error.";
  }
});

mountForm.requestSubmit();
