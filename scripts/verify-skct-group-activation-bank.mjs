#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { previewSkctBankActivation } from "../apps/backend/src/modules/admin/admin-skct-bank-use-cases.ts";

const bankArgument = process.argv.at(2);
if (!bankArgument) throw new Error("usage: npm run verify:skct-group-activation-bank -- /absolute/path/to/bank.json");
const bankPath = path.resolve(bankArgument);
const bank = JSON.parse(await readFile(bankPath, "utf8"));
const result = await previewSkctBankActivation(bank);
process.stdout.write(`${JSON.stringify({ bankPath, ...result }, null, 2)}\n`);
