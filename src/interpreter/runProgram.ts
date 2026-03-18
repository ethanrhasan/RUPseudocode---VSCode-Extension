type Inputs = Record<string, string | number>;

export function runProgram(source: string, opts: { inputs?: Inputs } = {}) {
  const vars = new Map<string, any>();
  const output: string[] = [];
  const inputs = opts.inputs ?? {};

  const lines = source
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("//"));

  let pc = 0;

  const getValue = (token: string) => {
    if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
    if (token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1);
    if (vars.has(token)) return vars.get(token);
    throw new Error(`Undefined variable: ${token}`);
  };

  const evalCondition = (expr: string): boolean => {
    expr = expr.trim();
    if (expr.startsWith("(") && expr.endsWith(")")) {
      expr = expr.slice(1, -1).trim();
    }

    if (/\bOR\b/i.test(expr)) {
      return expr.split(/\bOR\b/i).some(part => evalCondition(part.trim()));
    }
    if (/\bAND\b/i.test(expr)) {
      return expr.split(/\bAND\b/i).every(part => evalCondition(part.trim()));
    }

    const natMatch = expr.match(/^(.+?)\s+is\s+(above|below|not|at least|at most)?\s*(.+)$/i);
    if (natMatch) {
      const a = getValue(natMatch[1].trim());
      const qualifier = (natMatch[2] || "").toLowerCase().trim();
      const b = getValue(natMatch[3].trim());
      if (qualifier === "above")    return a > b;
      if (qualifier === "below")    return a < b;
      if (qualifier === "not")      return a != b;
      if (qualifier === "at least") return a >= b;
      if (qualifier === "at most")  return a <= b;
      return a == b;
    }

    const symMatch = expr.match(/^(.+?)\s*(>=|<=|!=|>|<|=)\s*(.+)$/);
    if (symMatch) {
      const a = getValue(symMatch[1].trim());
      const op = symMatch[2];
      const b = getValue(symMatch[3].trim());
      if (op === ">=") return a >= b;
      if (op === "<=") return a <= b;
      if (op === "!=") return a != b;
      if (op === ">")  return a > b;
      if (op === "<")  return a < b;
      if (op === "=")  return a == b;
    }

    throw new Error(`Invalid condition: ${expr}`);
  };

  const findForward = (from: number, openWord: string, closeWord: string): number => {
    let depth = 1;
    for (let i = from + 1; i < lines.length; i++) {
      if (lines[i].toUpperCase().startsWith(openWord))  depth++;
      if (lines[i].toUpperCase().startsWith(closeWord)) depth--;
      if (depth === 0) return i;
    }
    throw new Error(`No matching ${closeWord} for ${openWord} at line ${from + 1}`);
  };

  const findBackward = (from: number, openWord: string, closeWord: string): number => {
    let depth = 1;
    for (let i = from - 1; i >= 0; i--) {
      if (lines[i].toUpperCase().startsWith(closeWord)) depth++;
      if (lines[i].toUpperCase().startsWith(openWord))  depth--;
      if (depth === 0) return i;
    }
    throw new Error(`No matching ${openWord} for ${closeWord} at line ${from + 1}`);
  };

  while (pc < lines.length) {
    const line = lines[pc];

    if (line === "HALT") break;

    if (line.startsWith("DISPLAY ")) {
      const expr = line.slice("DISPLAY ".length).trim();
      output.push(String(getValue(expr)));
      pc++;
      continue;
    }

    if (line.startsWith("READ ")) {
      const name = line.slice("READ ".length).trim();
      if (!(name in inputs)) throw new Error(`Missing input for READ ${name}`);
      vars.set(name, inputs[name]);
      pc++;
      continue;
    }

    const setMatch = line.match(/^SET\s+([A-Za-z_]\w*)\s+TO\s+(.+)$/);
    if (setMatch) {
      const [, name, rhs] = setMatch;
      vars.set(name, getValue(rhs.trim()));
      pc++;
      continue;
    }

    const addMatch = line.match(/^ADD\s+(.+)\s+TO\s+([A-Za-z_]\w*)$/);
    if (addMatch) {
      const [, amount, name] = addMatch;
      vars.set(name, (vars.get(name) ?? 0) + getValue(amount.trim()));
      pc++;
      continue;
    }

    const subMatch = line.match(/^SUBTRACT\s+(.+)\s+FROM\s+([A-Za-z_]\w*)$/);
    if (subMatch) {
      const [, amount, name] = subMatch;
      vars.set(name, (vars.get(name) ?? 0) - getValue(amount.trim()));
      pc++;
      continue;
    }
    const computeMatch = line.match(/^COMPUTE\s+([A-Za-z_]\w*)\s+AS\s+(.+)$/i);
    if (computeMatch) {
      const [, name, expr] = computeMatch;
      const substituted = expr.replace(/[A-Za-z_]\w*/g, (token) => {
        if (vars.has(token)) return vars.get(token);
        throw new Error(`Undefined variable in expression: ${token}`);
      });
      const result = Function('"use strict"; return (' + substituted + ')')();
      vars.set(name, result);
      pc++;
      continue;
    }

    const ifMatch = line.match(/^IF\s+(.+?)\s+THEN$/i);
    if (ifMatch) {
      if (evalCondition(ifMatch[1])) {
        pc++;
      } else {
        const endifIdx = findForward(pc, "IF ", "ENDIF");
        let elseIdx = -1, depth = 1;
        for (let i = pc + 1; i < endifIdx; i++) {
          if (lines[i].toUpperCase().match(/^IF\s/))  depth++;
          if (lines[i].toUpperCase() === "ENDIF")     depth--;
          if (depth === 1 && lines[i].toUpperCase() === "ELSE") {
            elseIdx = i;
            break;
          }
        }
        pc = elseIdx !== -1 ? elseIdx + 1 : endifIdx + 1;
      }
      continue;
    }

    if (line.toUpperCase() === "ELSE") {
      pc = findForward(pc, "IF ", "ENDIF") + 1;
      continue;
    }

    if (line.toUpperCase() === "ENDIF") { pc++; continue; }

    const whileMatch = line.match(/^WHILE\s+(.+)$/i);
    if (whileMatch) {
      if (evalCondition(whileMatch[1])) {
        pc++;
      } else {
        pc = findForward(pc, "WHILE ", "ENDWHILE") + 1;
      }
      continue;
    }

    if (line.toUpperCase() === "ENDWHILE") {
      pc = findBackward(pc, "WHILE ", "ENDWHILE");
      continue;
    }

    const forMatch = line.match(/^FOR\s+([A-Za-z_]\w*)\s+FROM\s+(.+?)\s+TO\s+(.+?)(?:\s+STEP\s+(.+))?$/i);
    if (forMatch) {
      const varName = forMatch[1];
      const initKey = `__for_${pc}`;
      if (!vars.has(initKey)) {
        vars.set(varName, getValue(forMatch[2].trim()));
        vars.set(initKey, true);
      }
      const end  = getValue(forMatch[3].trim());
      const step = forMatch[4] ? getValue(forMatch[4].trim()) : 1;
      if ((step >= 0 && vars.get(varName) <= end) ||
          (step <  0 && vars.get(varName) >= end)) {
        pc++;
      } else {
        vars.delete(initKey);
        pc = findForward(pc, "FOR ", "ENDFOR") + 1;
      }
      continue;
    }

    if (line.toUpperCase() === "ENDFOR") {
      const forIdx = findBackward(pc, "FOR ", "ENDFOR");
      const fm = lines[forIdx].match(/^FOR\s+([A-Za-z_]\w*)\s+FROM\s+(.+?)\s+TO\s+(.+?)(?:\s+STEP\s+(.+))?$/i);
      if (fm) {
        const step = fm[4] ? getValue(fm[4].trim()) : 1;
        vars.set(fm[1], (vars.get(fm[1]) ?? 0) + step);
      }
      pc = forIdx;
      continue;
    }

    throw new Error(`Unknown statement at line ${pc + 1}: ${line}`);
  }

  const cleanVars: Record<string, any> = {};
  for (const [k, v] of vars) {
    if (!k.startsWith("__for_")) cleanVars[k] = v;
  }
  return { vars: cleanVars, output };
}