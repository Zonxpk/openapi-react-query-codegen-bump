import type { ClassDeclaration, Project, SourceFile } from "ts-morph";
import ts from "typescript";
import {
  type MethodDescription,
  getClassNameFromClassNode,
  getClassesFromService,
} from "./common.mjs";
import { serviceFileName } from "./constants.mjs";

export type Service = {
  node: SourceFile;
  klasses: Array<{
    className: string;
    klass: ClassDeclaration;
    methods: Array<MethodDescription>;
  }>;
};

export async function getServices(project: Project): Promise<Service> {
  const node = project
    .getSourceFiles()
    .find((sourceFile) => sourceFile.getFilePath().includes(serviceFileName));

  if (!node) {
    throw new Error("No service node found");
  }

  // Check if we have classes (old format) or variable declarations (new format)
  const klasses = node.getClasses();
  
  if (klasses.length > 0) {
    // Old class-based format
    return {
      klasses: klasses.map((klass) => {
        const className = klass.getName();
        if (!className) {
          throw new Error("Class name not found");
        }
        return {
          className,
          klass,
          methods: getMethodsFromService(node, klass),
        };
      }),
      node,
    } satisfies Service;
  }

  // New variable-based format (const exports)
  const variableDeclarations = node.getVariableDeclarations().filter(decl => {
    // Filter to only exported variables (excluding type declarations)
    return node.getExportedDeclarations().has(decl.getName());
  });
  
  if (!variableDeclarations.length) {
    throw new Error("No classes found"); // Keep same error for backward compatibility
  }

  return {
    klasses: [{
      className: "ApiService",
      klass: null as any, // Not needed for variable-based approach
      methods: variableDeclarations.map(varDecl => getMethodsFromVariable(node, varDecl)),
    }],
    node,
  } satisfies Service;
}

function getMethodsFromService(node: SourceFile, klass: ClassDeclaration) {
  const methods = klass.getMethods();
  if (!methods.length) {
    throw new Error("No methods found");
  }
  return methods.map((method) => {
    const methodBlockNode = method.compilerNode
      .getChildren(node.compilerNode)
      .find((child) => child.kind === ts.SyntaxKind.Block);

    if (!methodBlockNode) {
      throw new Error("Method block not found");
    }
    const methodBlock = methodBlockNode as ts.Block;
    const foundReturnStatement = methodBlock.statements.find(
      (s) => s.kind === ts.SyntaxKind.ReturnStatement,
    );
    if (!foundReturnStatement) {
      throw new Error("Return statement not found");
    }
    const returnStatement = foundReturnStatement as ts.ReturnStatement;
    const foundCallExpression = returnStatement.expression;
    if (!foundCallExpression) {
      throw new Error("Call expression not found");
    }
    const callExpression = foundCallExpression as ts.CallExpression;
    const properties = (
      callExpression.arguments[1] as ts.ObjectLiteralExpression
    ).properties as unknown as ts.PropertyAssignment[];
    const httpMethodName = properties
      .find((p) => p.name?.getText(node.compilerNode) === "method")
      ?.initializer?.getText(node.compilerNode);

    if (!httpMethodName) {
      throw new Error("httpMethodName not found");
    }

    const getAllChildren = (tsNode: ts.Node): Array<ts.Node> => {
      const childItems = tsNode.getChildren(node.compilerNode);
      if (childItems.length) {
        const allChildren = childItems.map(getAllChildren);
        return [tsNode].concat(allChildren.flat());
      }
      return [tsNode];
    };

    const children = getAllChildren(method.compilerNode);
    // get all JSDoc comments
    // this should be an array of 1 or 0
    const jsDocs = children
      .filter((c) => c.kind === ts.SyntaxKind.JSDoc)
      .map((c) => c.getText(node.compilerNode));
    // get the first JSDoc comment
    const jsDoc = jsDocs?.[0];
    const isDeprecated = children.some(
      (c) => c.kind === ts.SyntaxKind.JSDocDeprecatedTag,
    );

    const className = getClassNameFromClassNode(klass);

    return {
      className,
      node,
      method,
      methodBlock,
      httpMethodName,
      jsDoc,
      isDeprecated,
    } satisfies MethodDescription;
  });
}

function getMethodsFromVariable(node: SourceFile, varDecl: any) {
  // For variable-based exports (const exports), we need to extract HTTP method information
  // from the variable initializer (arrow function implementation)
  
  const variableName = varDecl.getName();
  if (!variableName) {
    throw new Error("Variable name not found");
  }

  // Get the initializer (the arrow function)
  const initializer = varDecl.getInitializer();
  if (!initializer) {
    throw new Error("Variable initializer not found");
  }

  // Look for HTTP method in the arrow function call - e.g., client.get(), client.post()
  const initializerText = initializer.getText();
  
  let httpMethod = "GET"; // default
  
  // Use more robust pattern matching for HTTP methods (with or without generics)
  if (initializerText.match(/\.post\s*[<(]/)) {
    httpMethod = "POST";
  } else if (initializerText.match(/\.put\s*[<(]/)) {
    httpMethod = "PUT";
  } else if (initializerText.match(/\.patch\s*[<(]/)) {
    httpMethod = "PATCH";
  } else if (initializerText.match(/\.delete\s*[<(]/)) {
    httpMethod = "DELETE";
  } else if (initializerText.match(/\.get\s*[<(]/)) {
    httpMethod = "GET";
  }

  // Get JSDoc comments from the variable declaration - variable declarations may not have direct JSDoc
  // Let's try to get it from the parent statement or look for comments in the text
  let jsDoc = "";
  try {
    const leadingComments = varDecl.getLeadingCommentRanges();
    if (leadingComments.length > 0) {
      jsDoc = leadingComments[0].getText();
    }
  } catch (e) {
    // Fallback: look for JSDoc pattern in the surrounding text
    const varStatement = varDecl.getVariableStatementOrThrow();
    const fullText = varStatement.getText();
    const jsDocMatch = fullText.match(/\/\*\*([\s\S]*?)\*\//);
    if (jsDocMatch) {
      jsDoc = jsDocMatch[0];
    }
  }
  
  // Check for deprecation
  const isDeprecated = jsDoc.includes("@deprecated") || initializerText.includes("@deprecated");

  return {
    className: "ApiService", // Virtual class name
    node,
    method: varDecl, // Use variable declaration as method for compatibility
    methodBlock: initializer, // Use initializer as method block
    httpMethodName: `"${httpMethod}"`, // Quoted string to match expected format
    jsDoc,
    isDeprecated,
  } satisfies MethodDescription;
}

function getMethodsFromFunction(node: SourceFile, func: any) {
  // For function-based exports, we need to extract HTTP method information
  // from the function implementation rather than class methods
  
  const functionName = func.getName();
  if (!functionName) {
    throw new Error("Function name not found");
  }

  // Get the function body
  const functionBody = func.getBody();
  if (!functionBody) {
    throw new Error("Function body not found");
  }

  // Look for HTTP method in the function call - e.g., client.get(), client.post()
  // This is a simplified approach for the new function-based structure
  const bodyText = functionBody.getText();
  
  let httpMethod = "GET"; // default
  if (bodyText.includes(".post(")) {
    httpMethod = "POST";
  } else if (bodyText.includes(".put(")) {
    httpMethod = "PUT";
  } else if (bodyText.includes(".patch(")) {
    httpMethod = "PATCH";
  } else if (bodyText.includes(".delete(")) {
    httpMethod = "DELETE";
  } else if (bodyText.includes(".get(")) {
    httpMethod = "GET";
  }

  // Get JSDoc comments
  const jsDocs = func.getJsDocs();
  const jsDoc = jsDocs.length > 0 ? jsDocs[0].getText() : "";
  
  // Check for deprecation
  const isDeprecated = jsDoc.includes("@deprecated") || bodyText.includes("@deprecated");

  return {
    className: "ApiService", // Virtual class name for functions
    node,
    method: func, // Use function as method for compatibility
    methodBlock: functionBody, // Use function body as method block
    httpMethodName: `"${httpMethod}"`, // Quoted string to match expected format
    jsDoc,
    isDeprecated,
  } satisfies MethodDescription;
}
