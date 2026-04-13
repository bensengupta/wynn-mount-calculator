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

/**
 * @typedef {{ highestStat: number, limit: Stats, max: Stats }} MountInfo
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
  const target = subtractStats(mountInfo.max, mountInfo.limit);
  const allowedIngredients = allIngredients.filter((ing) => ing.level <= mountInfo.highestStat);

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

/** @type {MountInfo} */
const mountInfo = {
  highestStat: 10,
  limit: [10, 10, 10, 10, 10, 10, 10, 10],
  max: [40, 40, 40, 40, 40, 40, 40, 40],
};
const options = {
  timeImportance: 0.5,
  timeLimitSeconds: 3,
};

const result = await calculateIngredients(mountInfo, options);
const { time, status, totalQuantity, totalCost, ingredients } = result;

console.log(`Time: ${time} seconds`);

console.log("Solution:");
console.log(`Status: ${status}`);
console.log(`Cost: ${totalCost}`);
console.log(`Num ingredients: ${totalQuantity}`);
for (const { ingredient, quantity } of ingredients) {
  for (let i = 0; i < quantity; i++) {
    console.log(`  ${ingredient.name} (Level ${ingredient.level})`);
  }
}
