/** Durable named recipe checkpoints. This is not a DAG engine or scheduler. */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const RECIPE_ID = /^recipe-[0-9]{13}-[a-f0-9]{8}$/;

function dir(root) {
  const value = path.join(root, "work", "bridge", "recipes-v1");
  fs.mkdirSync(value, { recursive: true });
  return value;
}

function file(root, recipeId) {
  if (!RECIPE_ID.test(String(recipeId || ""))) throw new Error("Invalid recipe id");
  return path.join(dir(root), `${recipeId}.json`);
}

function atomic(target, value) {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, target);
}

export function createRecipe(root, spec) {
  const now = new Date().toISOString();
  const recipeId = `recipe-${Date.now()}-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const record = {
    schema: "hanako.recipe.v1",
    recipe_id: recipeId,
    recipe: spec.recipe,
    task_id: spec.task_id || null,
    state: "RUNNING",
    inputs: spec.inputs || {},
    steps: spec.steps.map(step => ({
      step_id: step.step_id, capability: step.capability, state: "PENDING", attempt: 0,
      job_id: null, input_artifacts: [], output_artifacts: [], evidence: null, error: null,
    })),
    created_at: now, updated_at: now, finished_at: null,
  };
  atomic(file(root, recipeId), record);
  return record;
}

export function getRecipe(root, recipeId) {
  const target = file(root, recipeId);
  if (!fs.existsSync(target)) return null;
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

export function updateRecipe(root, recipeId, changes) {
  const current = getRecipe(root, recipeId);
  if (!current) throw new Error("Recipe not found");
  const next = { ...current, ...changes, recipe_id: current.recipe_id, schema: current.schema, updated_at: new Date().toISOString() };
  atomic(file(root, recipeId), next);
  return next;
}

export function updateStep(root, recipeId, stepId, changes) {
  const current = getRecipe(root, recipeId);
  if (!current) throw new Error("Recipe not found");
  const found = current.steps.some(step => step.step_id === stepId);
  if (!found) throw new Error(`Recipe step not found: ${stepId}`);
  const steps = current.steps.map(step => step.step_id === stepId ? { ...step, ...changes } : step);
  return updateRecipe(root, recipeId, { steps });
}
