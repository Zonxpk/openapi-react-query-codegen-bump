import type { Project, SourceFile, VariableDeclaration } from "ts-morph";
import ts from "typescript";
import type { FunctionDescription } from "./common.mjs";
import { serviceFileName } from "./constants.mjs";

export type Service = {
  node: SourceFile;
  methods: Array<FunctionDescription>;
};

export async function getServices(project: Project): Promise<Service> {
  const node = project
    .getSourceFiles()
    .find((sourceFile) => sourceFile.getFilePath().includes(serviceFileName));

  if (!node) {
    throw new Error("No service node found");
  }

  const methods = getMethodsFromService(node);
  return {
    methods,
    node,
  } satisfies Service;
}

export function getMethodsFromService(node: SourceFile): FunctionDescription[] {
  // In the new version, functions are exported as const declarations
  const exportedDeclarations = node.getExportedDeclarations();
  const methods: FunctionDescription[] = [];

  for (const [name, declarations] of exportedDeclarations) {
    if (name === 'Options' || name === 'default') {
      continue; // Skip type exports and default exports
    }

    for (const declaration of declarations) {
      if (declaration.getKind() === ts.SyntaxKind.VariableDeclaration) {
        const variableDeclaration = declaration as VariableDeclaration;
        const initializer = variableDeclaration.getInitializer();
        
        if (initializer && ts.isArrowFunction(initializer.compilerNode)) {
          const arrowFunction = initializer.compilerNode;
          const methodBlockNode = arrowFunction.body;
          
          if (methodBlockNode && ts.isBlock(methodBlockNode)) {
            const foundReturnStatement = methodBlockNode.statements.find(
              (s) => s.kind === ts.SyntaxKind.ReturnStatement,
            );
            
            if (foundReturnStatement) {
              const returnStatement = foundReturnStatement as ts.ReturnStatement;
              const foundCallExpression = returnStatement.expression;
              
              if (foundCallExpression) {
                const callExpression = foundCallExpression as ts.CallExpression;
                
                // Extract HTTP method name from the new structure
                // e.g., (options?.client ?? _heyApiClient).get(...) -> "get"
                let httpMethodName = '';
                if (ts.isPropertyAccessExpression(callExpression.expression)) {
                  httpMethodName = callExpression.expression.name.getText();
                } else if (ts.isCallExpression(callExpression.expression)) {
                  // Handle chained expressions
                  const expr = callExpression.expression as ts.CallExpression;
                  if (ts.isPropertyAccessExpression(expr.expression)) {
                    httpMethodName = expr.expression.name.getText();
                  }
                }

                if (!httpMethodName) {
                  continue; // Skip if we can't determine the HTTP method
                }

                const getAllChildren = (tsNode: ts.Node): Array<ts.Node> => {
                  const childItems = tsNode.getChildren(node.compilerNode);
                  if (childItems.length) {
                    const allChildren = childItems.map(getAllChildren);
                    return [tsNode].concat(allChildren.flat());
                  }
                  return [tsNode];
                };

                const children = getAllChildren(initializer.compilerNode);
                // get all JSDoc comments
                const jsDocs = children
                  .filter((c) => c.kind === ts.SyntaxKind.JSDoc)
                  .map((c) => c.getText(node.compilerNode));
                // get the first JSDoc comment
                const jsDoc = jsDocs?.[0];
                const isDeprecated = children.some(
                  (c) => c.kind === ts.SyntaxKind.JSDocDeprecatedTag,
                );

                const methodDescription: FunctionDescription = {
                  node,
                  method: variableDeclaration,
                  methodBlock: methodBlockNode,
                  httpMethodName,
                  jsDoc,
                  isDeprecated,
                } satisfies FunctionDescription;

                methods.push(methodDescription);
              }
            }
          }
        }
      }
    }
  }

  return methods;
}
