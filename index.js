// @ts-check

import allIngredients from "./ingredients.json" with { type: "json" };
import GLPKFactory from "glpk.js";

/**
 * @typedef {number[]} Stats
 * @typedef {import("glpk.js").GLPK} GLPK
 */

/**
 * @param {unknown} condition
 * @param {string} [message]
 * @returns {asserts condition}
 */
export function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(message);
  }
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
 * @param {GLPK} glpk
 * @returns {string}
 */
function serializeGLPKStatus(status, glpk) {
  switch (status) {
    case glpk.GLP_OPT:
      return "🟢Solution is optimal";
    case glpk.GLP_FEAS:
      return "🟡Solution found, but not proven optimal";
    case glpk.GLP_INFEAS:
    case glpk.GLP_NOFEAS:
      return "🔴Impossible";
    case glpk.GLP_UNBND:
      return "🔴Unbounded";
    case glpk.GLP_UNDEF:
      return "🔴Undefined";
    default:
      return `🔴Unknown (${status})`;
  }
}

export class AbortedCalculationError extends Error {
  constructor() {
    super("Calculation aborted");
    this.name = "AbortedCalculationError";
  }
}

/**
 * @param {MountInfo} mountInfo
 * @param {{
 *  timeImportance: number,
 *  timeLimitSeconds: number,
 *  signal: AbortSignal,
 * }} opts
 */
export async function calculateIngredients(mountInfo, opts) {
  const highestCurrentStat = Math.max(...mountInfo.current);
  const target = subtractStats(mountInfo.max, mountInfo.limit);
  const allowedIngredients = allIngredients.filter((ing) =>
    ing.level <= highestCurrentStat
  );

  const objective = allowedIngredients.map((ing, idx) => ({
    name: `x${idx}`,
    coef: opts.timeImportance * 60 + (1 - opts.timeImportance) * ing.level,
  }));

  const glpk = await GLPKFactory();
  if (opts.signal.aborted) {
    glpk.terminate();
    throw new AbortedCalculationError();
  }

  opts.signal.addEventListener('abort', () => {
    glpk.terminate();
  });

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
  if (opts.signal.aborted) {
    throw new AbortedCalculationError();
  }

  const ingredients = Object.entries(result.vars)
    .filter(([_, varValue]) => varValue > 0)
    .map(([varName, varValue]) => {
      const ingIdx = parseInt(varName.substring(1));
      return {
        ingIdx,
        ingredient: allowedIngredients[ingIdx],
        quantity: varValue,
      };
    })
    .sort((a, b) => b.ingredient.level - a.ingredient.level);

  return {
    time,
    status: serializeGLPKStatus(result.status, glpk),
    ingredients,
    totalQuantity: ingredients.reduce((sum, ing) => sum + ing.quantity, 0),
    totalCost: ingredients.reduce(
      (sum, ing) => sum + ing.ingredient.level * ing.quantity,
      0,
    ),
  };
}

/**
 * @param {number} end
 * @returns {number[]}
 */
export function range(end) {
  return [...Array(end).keys()]
}

/**
 * @param {URLSearchParams} searchParams
 */
export function parseSearchParams(searchParams) {
  // format: c1.c2...c8-l1.l2...l8-m1.m2...m8
  const stats = searchParams.get('stats') ?? '';

  const statsParts = stats
    .split('-')
    .map((part) => part.split('.'));

  const statFormValues = range(8).flatMap((i) => [
    { name: `current-${i}`, value: statsParts[0]?.[i] || "1" },
    { name: `limit-${i}`, value: statsParts[1]?.[i] || "10" },
    { name: `max-${i}`, value: statsParts[2]?.[i] || "30" },
  ]);

  const timeImportance = searchParams.get('timeImportance') ?? "0.5";
  statFormValues.push({ name: 'timeImportance', value: timeImportance });

  const timeLimitSeconds = searchParams.get('timeLimitSeconds') ?? "3";
  statFormValues.push({ name: 'timeLimitSeconds', value: timeLimitSeconds });

  return statFormValues;
}

/**
 * @param {URLSearchParams} searchParams
 * @param {FormData} formData
 */
export function updateSearchParams(searchParams, formData) {
  const statsParam = [
    range(8).map((i) => formData.get(`current-${i}`)).join('.'),
    range(8).map((i) => formData.get(`limit-${i}`)).join('.'),
    range(8).map((i) => formData.get(`max-${i}`)).join('.'),
  ].join('-');
  searchParams.set('stats', statsParam);

  const timeImportance = String(formData.get('timeImportance'));
  searchParams.set('timeImportance', timeImportance);

  const timeLimitSeconds = String(formData.get('timeLimitSeconds'));
  searchParams.set('timeLimitSeconds', timeLimitSeconds);
}

/**
 * @param {HTMLFormElement} form
 */
export function validateForm(form) {
  for (let i = 0; i < 8; i++) {
    const currentInput = form.querySelector(`input[name="current-${i}"]`);
    assert(currentInput instanceof HTMLInputElement, `Missing input for current-${i}`);

    const limitInput = form.querySelector(`input[name="limit-${i}"]`);
    assert(limitInput instanceof HTMLInputElement, `Missing input for limit-${i}`);

    currentInput.setCustomValidity("");
    if (!currentInput.validity.valid || !limitInput.validity.valid) {
      continue;
    }

    const currentVal = Number(currentInput.value);
    const limitVal = Number(limitInput.value);

    if (currentVal > limitVal) {
      currentInput.setCustomValidity("Current stat cannot be greater than Limit stat");
    }
  }

  for (let i = 0; i < 8; i++) {
    const limitInput = form.querySelector(`input[name="limit-${i}"]`);
    assert(limitInput instanceof HTMLInputElement, `Missing input for limit-${i}`);

    const maxInput = form.querySelector(`input[name="max-${i}"]`);
    assert(maxInput instanceof HTMLInputElement, `Missing input for max-${i}`);

    limitInput.setCustomValidity("");
    if (!limitInput.validity.valid || !maxInput.validity.valid) {
      continue;
    }

    const limitVal = Number(limitInput.value);
    const maxVal = Number(maxInput.value);

    if (limitVal > maxVal) {
      limitInput.setCustomValidity("Limit stat cannot be greater than Max stat");
    }
  }
}

/**
 * @param {number} ingIdx
 * @return {[number, number]}
 */
export function itemSpriteSheetCoords(ingIdx) {
  const NUM_SPRITESHEET_COLS = 16;
  const SPRITE_SIZE = 32;

  const level = Math.floor(ingIdx / 8);
  const category = Math.floor((ingIdx - level * 8) / 2);
  const type = ingIdx % 2;

  const spriteIdx = 13 + category * 48 + level * 3 + type;

  const row = Math.floor(spriteIdx / NUM_SPRITESHEET_COLS);
  const col = spriteIdx % NUM_SPRITESHEET_COLS;

  const x = col * SPRITE_SIZE;
  const y = row * SPRITE_SIZE;

  return [x, y];
}
