import { API } from "typescript/unstable/sync";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import { isFunctionDeclaration, isReturnStatement } from "typescript/unstable/ast/is";
import type { Node } from "typescript/unstable/ast";
import path from "node:path";
import process from "node:process";

// 1. El código de entrada (TypeScript)
const tsCode = `
  function calcularDescuento(precio: number, porcentaje: number): number {
      return precio - (precio * porcentaje);
  }
`;

// 2. Inicializamos la API de TypeScript 7 y el sistema de archivos virtual
const cwd = process.cwd();
const tempTs = path.join(cwd, "temp.ts");

const api = new API({
    cwd,
    fs: createVirtualFileSystem({
        [tempTs]: tsCode
    })
});

// Generamos el Árbol Sintáctico Abstracto (AST) cargándolo en un snapshot
const snapshot = api.updateSnapshot({ openFiles: [tempTs] });
const sourceFile = snapshot.getDefaultProjectForFile(tempTs)!.program.getSourceFile(tempTs)!;

// 3. Función auxiliar para mapear tipos de TS a PostgreSQL
function mapTypeToPg(tsType: string): string {
    switch (tsType) {
        case "number": return "NUMERIC";
        case "string": return "VARCHAR";
        case "boolean": return "BOOLEAN";
        default: return "TEXT";
    }
}

// 4. Recorremos el AST buscando la función
function transpilarNodo(nodo: Node) {
    // Verificamos si el nodo actual es la declaración de una función
    if (isFunctionDeclaration(nodo)) {

        // A. Extraer el nombre de la función
        const funcName = nodo.name?.text || "funcion_anonima";

        // B. Extraer y mapear los parámetros
        const parametros = nodo.parameters.map(param => {
            const nombreParam = param.name.getText(sourceFile);
            const tipoParamTs = param.type?.getText(sourceFile) || "any";
            const tipoPg = mapTypeToPg(tipoParamTs);
            return `${nombreParam} ${tipoPg}`;
        }).join(', ');

        // C. Extraer y mapear el tipo de retorno
        const tipoRetornoTs = nodo.type?.getText(sourceFile) || "any";
        const tipoRetornoPg = mapTypeToPg(tipoRetornoTs);

        // D. Extraer el cuerpo (aislamos la expresión matemática del 'return')
        let sqlBody = "";
        const primerStatement = nodo.body?.statements[0];

        if (primerStatement && isReturnStatement(primerStatement)) {
            const expresion = primerStatement.expression?.getText(sourceFile);
            sqlBody = `RETURN ${expresion};`;
        }

        // 5. Ensamblar la plantilla de PL/pgSQL
        const sqlGenerado = `
CREATE OR REPLACE FUNCTION ${funcName}(${parametros})
RETURNS ${tipoRetornoPg} AS $$
BEGIN
    ${sqlBody}
END;
$$ LANGUAGE plpgsql;`;

        console.log("=== CÓDIGO GENERADO (PL/pgSQL) ===");
        console.log(sqlGenerado);
    }

    // Continuar recorriendo los nodos hijos recursivamente
    nodo.forEachChild(transpilarNodo);
}

// Ejecutar el transpilador
transpilarNodo(sourceFile);

// Cerrar la API para evitar que el proceso se quede colgado
api.close();