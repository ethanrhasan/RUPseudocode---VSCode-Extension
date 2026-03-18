import * as vscode from "vscode";
import { runProgram } from "./interpreter/runProgram";

export function activate(context: vscode.ExtensionContext) {
  console.log("ahhhhhh shieeeeet");
  const output = vscode.window.createOutputChannel("Pseudocode Output");

  const disposable = vscode.commands.registerCommand("angelopseudocode.run", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const code = editor.document.getText();
    output.clear();
    output.show(true);

    try {
      const readVars = [...code.matchAll(/^\s*READ\s+([A-Za-z_]\w*)/gm)]
        .map((m) => m[1]);

      const inputs: Record<string, string | number> = {};
      for (const varName of readVars) {
        const value = await vscode.window.showInputBox({
          prompt: `Enter value for: ${varName}`,
          title: `READ ${varName}`,
          ignoreFocusOut: true, 
        });

        if (value === undefined) {
          output.appendLine("Program cancelled.");
          return;
        }

        inputs[varName] = /^-?\d+(\.\d+)?$/.test(value.trim())
          ? Number(value.trim())
          : value;
      }

      const result = runProgram(code, { inputs });

      for (const line of result.output) {
        output.appendLine(line);
      }
    } catch (err: any) {
      output.appendLine(`Error: ${err?.message ?? String(err)}`);
    }
  });

  context.subscriptions.push(disposable, output);
}

export function deactivate() {}