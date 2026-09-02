#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx"]);
const FORBIDDEN_PACKAGE_PREFIXES = ["@earendil-works/pi", "@aibyzero/byz"];
const COMPOSITION_ARGUMENTS = new Map([
	["diagnosticsFeature", "createPiExtensionPorts(pi).diagnostics"],
	["conversationExtension", "ports.conversation"],
	["executionExtension", "ports.execution"],
	["workflowExtension", "ports.workflow"],
	["fastController.extension", "ports.fast"],
	["prewalkExtension", "ports.prewalk"],
]);

async function collectSourceFiles(root) {
	const files = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = resolve(root, entry.name);
		if (entry.isDirectory()) files.push(...(await collectSourceFiles(path)));
		else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(path);
	}
	return files;
}

function parseSource(file, content) {
	const extension = extname(file);
	const scriptKind =
		extension === ".tsx" ? ts.ScriptKind.TSX : extension === ".ts" ? ts.ScriptKind.TS : ts.ScriptKind.JS;
	return ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind);
}

function getViolation(file, specifier, sourceRoot) {
	if (specifier === "fs" || specifier.startsWith("fs/") || specifier.startsWith("node:fs")) {
		return "Node filesystem implementation";
	}
	if (/sqlite/i.test(specifier)) return "SQLite implementation";
	if (
		FORBIDDEN_PACKAGE_PREFIXES.some(
			(prefix) => specifier === prefix || specifier.startsWith(`${prefix}-`) || specifier.startsWith(`${prefix}/`),
		)
	) {
		return "Pi/runtime implementation package";
	}
	if (!specifier.startsWith(".")) return undefined;
	const target = resolve(dirname(file), specifier);
	if (target !== sourceRoot && !target.startsWith(`${sourceRoot}${sep}`)) return "external implementation";
	const adaptersRoot = resolve(sourceRoot, "adapters");
	const runtimeRoot = resolve(sourceRoot, "runtime");
	if (target === adaptersRoot || target.startsWith(`${adaptersRoot}${sep}`)) return "adapter implementation";
	if (target === runtimeRoot || target.startsWith(`${runtimeRoot}${sep}`)) return "runtime implementation";
	return undefined;
}

function collectModuleSpecifiers(sourceFile) {
	const references = [];
	function visit(node) {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteralLike(node.moduleSpecifier)
		) {
			references.push({ specifier: node.moduleSpecifier.text, dynamic: false });
		} else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			const [argument] = node.arguments;
			references.push(
				argument && ts.isStringLiteralLike(argument)
					? { specifier: argument.text, dynamic: false }
					: { specifier: "<non-literal dynamic import>", dynamic: true },
			);
		} else if (ts.isImportTypeNode(node)) {
			const literal = node.argument.literal;
			references.push(
				ts.isStringLiteralLike(literal)
					? { specifier: literal.text, dynamic: false }
					: { specifier: "<non-literal import type>", dynamic: true },
			);
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	return references;
}

function getPropertyName(node) {
	if (!node.name) return undefined;
	if (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) return node.name.text;
	return undefined;
}

async function checkPiAdapterBoundary(packageRoot, sourceRoot) {
	const adapterRoot = resolve(sourceRoot, "adapters", "pi");
	let files;
	try {
		files = await collectSourceFiles(adapterRoot);
	} catch (error) {
		if (error?.code === "ENOENT") return [];
		throw error;
	}
	const violations = [];
	for (const file of files) {
		const content = await readFile(file, "utf8");
		const sourceFile = parseSource(file, content);
		function visit(node) {
			if (ts.isIdentifier(node) && node.text === "Proxy") {
				violations.push({
					file: relative(packageRoot, file),
					specifier: "Proxy",
					reason: "transparent Pi capability",
				});
			}
			if (ts.isIdentifier(node) && node.text === "createPiExtensionAdapter") {
				violations.push({
					file: relative(packageRoot, file),
					specifier: "createPiExtensionAdapter",
					reason: "legacy full-context adapter",
				});
			}
			if (
				(ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node)) &&
				["raw", "pi", "api"].includes(getPropertyName(node) ?? "")
			) {
				violations.push({
					file: relative(packageRoot, file),
					specifier: getPropertyName(node),
					reason: "raw Pi escape property",
				});
			}
			ts.forEachChild(node, visit);
		}
		visit(sourceFile);
	}
	return violations;
}

async function checkCompositionBoundary(packageRoot, sourceRoot) {
	const cliPath = resolve(sourceRoot, "cli.js");
	let content;
	try {
		content = await readFile(cliPath, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") return [];
		throw error;
	}
	const sourceFile = parseSource(cliPath, content);
	const seen = new Map([...COMPOSITION_ARGUMENTS.keys()].map((callee) => [callee, 0]));
	const violations = [];
	function visit(node) {
		if (ts.isCallExpression(node)) {
			const callee = node.expression.getText(sourceFile);
			const expected = COMPOSITION_ARGUMENTS.get(callee);
			if (expected) {
				seen.set(callee, (seen.get(callee) ?? 0) + 1);
				const actual = node.arguments.length === 1 ? node.arguments[0].getText(sourceFile) : "<invalid-arguments>";
				if (actual !== expected) {
					violations.push({
						file: relative(packageRoot, cliPath),
						specifier: `${callee}(${actual})`,
						reason: "raw or incorrect feature capability composition",
					});
				}
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	for (const [callee, count] of seen) {
		if (count !== 1) {
			violations.push({
				file: relative(packageRoot, cliPath),
				specifier: `${callee} count=${count}`,
				reason: "missing or duplicate feature capability composition",
			});
		}
	}
	return violations;
}

export async function checkArchitecture(options = {}) {
	const packageRoot = resolve(options.packageRoot ?? fileURLToPath(new URL("..", import.meta.url)));
	const sourceRoot = resolve(packageRoot, "src");
	const roots = [resolve(sourceRoot, "domain"), resolve(sourceRoot, "application")];
	const violations = [
		...(await checkPiAdapterBoundary(packageRoot, sourceRoot)),
		...(await checkCompositionBoundary(packageRoot, sourceRoot)),
	];
	for (const root of roots) {
		let files;
		try {
			files = await collectSourceFiles(root);
		} catch (error) {
			if (error?.code === "ENOENT") continue;
			throw error;
		}
		for (const file of files) {
			const content = await readFile(file, "utf8");
			for (const reference of collectModuleSpecifiers(parseSource(file, content))) {
				if (reference.dynamic) {
					violations.push({
						file: relative(packageRoot, file),
						specifier: reference.specifier,
						reason: "dynamic implementation import",
					});
					continue;
				}
				const reason = getViolation(file, reference.specifier, sourceRoot);
				if (reason) violations.push({ file: relative(packageRoot, file), specifier: reference.specifier, reason });
			}
		}
	}
	return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const violations = await checkArchitecture();
	if (violations.length > 0) {
		for (const violation of violations) {
			console.error(`${violation.file}: forbidden ${violation.reason} ${JSON.stringify(violation.specifier)}`);
		}
		process.exitCode = 1;
	} else {
		console.log("BYZ architecture dependency check passed.");
	}
}
