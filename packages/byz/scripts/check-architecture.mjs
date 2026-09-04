#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx"]);
const FORBIDDEN_PACKAGE_PREFIXES = ["@earendil-works/pi", "@aibyzero/byz"];
const COMPOSITION_FILE = "src/cli.js";
const FEATURE_INSTANCES = new Map([
	["diagnosticsFeature", { displayName: "diagnosticsFeature", kind: "callable", port: "diagnostics" }],
	["conversationExtension", { displayName: "conversationExtension", kind: "callable", port: "conversation" }],
	["executionExtension", { displayName: "executionExtension", kind: "callable", port: "execution" }],
	["workflowExtension", { displayName: "workflowExtension", kind: "callable", port: "workflow" }],
	["fastController", { displayName: "fastController.extension", kind: "controller", port: "fast" }],
	["prewalkExtension", { displayName: "prewalkExtension", kind: "callable", port: "prewalk" }],
	["pauseExtension", { displayName: "pauseExtension", kind: "callable", port: "pause", required: false }],
	["deliveryExtension", { displayName: "deliveryExtension", kind: "callable", port: "delivery", required: false }],
]);
const FEATURE_CREATORS = new Map([
	[
		"createDiagnosticsExtension",
		{ origin: FEATURE_INSTANCES.get("diagnosticsFeature"), source: "src/diagnostics/diagnostics-extension.js" },
	],
	[
		"createConversationExtension",
		{ origin: FEATURE_INSTANCES.get("conversationExtension"), source: "src/conversation/conversation-extension.js" },
	],
	[
		"createExecutionExtension",
		{ origin: FEATURE_INSTANCES.get("executionExtension"), source: "src/execution/execution-extension.js" },
	],
	[
		"createWorkflowSwitchExtension",
		{ origin: FEATURE_INSTANCES.get("workflowExtension"), source: "src/workflow-switch.js" },
	],
	["createFastSessionController", { origin: FEATURE_INSTANCES.get("fastController"), source: "src/fast-session.js" }],
	["createPrewalkExtension", { origin: FEATURE_INSTANCES.get("prewalkExtension"), source: "src/prewalk.js" }],
	[
		"createPauseExtension",
		{ origin: FEATURE_INSTANCES.get("pauseExtension"), source: "src/execution/pause-extension.js" },
	],
	[
		"createDeliveryExtension",
		{ origin: FEATURE_INSTANCES.get("deliveryExtension"), source: "src/delivery/delivery-extension.js" },
	],
]);
const RAW_ESCAPE_PROPERTIES = new Set(["raw", "pi", "api", "context"]);

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

export function normalizeArchitectureRelativePath(path, pathSeparator = sep) {
	return pathSeparator === "/" ? path : path.split(pathSeparator).join("/");
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

function getStaticName(node) {
	if (!node) return undefined;
	if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
	if (ts.isComputedPropertyName(node) && ts.isStringLiteralLike(node.expression)) return node.expression.text;
	return undefined;
}

function unwrapExpression(node) {
	let current = node;
	while (
		ts.isParenthesizedExpression(current) ||
		ts.isAsExpression(current) ||
		ts.isTypeAssertionExpression(current) ||
		ts.isNonNullExpression(current) ||
		ts.isSatisfiesExpression(current)
	) {
		current = current.expression;
	}
	return current;
}

function isProxyReference(node) {
	return (
		(ts.isIdentifier(node) && node.text === "Proxy") ||
		(ts.isPropertyAccessExpression(node) && node.name.text === "Proxy") ||
		(ts.isElementAccessExpression(node) &&
			ts.isStringLiteralLike(node.argumentExpression) &&
			node.argumentExpression.text === "Proxy")
	);
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
	const seen = new Set();
	function addViolation(file, node, specifier, reason) {
		const key = `${file}:${node.pos}:${specifier}:${reason}`;
		if (seen.has(key)) return;
		seen.add(key);
		violations.push({ file: normalizeArchitectureRelativePath(relative(packageRoot, file)), specifier, reason });
	}
	for (const file of files) {
		const content = await readFile(file, "utf8");
		const sourceFile = parseSource(file, content);
		function visit(node) {
			if (isProxyReference(node)) addViolation(file, node, "Proxy", "transparent Pi capability");
			if (ts.isIdentifier(node) && node.text === "createPiExtensionAdapter") {
				addViolation(file, node, "createPiExtensionAdapter", "legacy full-context adapter");
			}
			if (
				ts.isPropertyAssignment(node) ||
				ts.isShorthandPropertyAssignment(node) ||
				ts.isMethodDeclaration(node) ||
				ts.isGetAccessorDeclaration(node) ||
				ts.isSetAccessorDeclaration(node) ||
				ts.isPropertyDeclaration(node) ||
				ts.isPropertySignature(node) ||
				ts.isMethodSignature(node)
			) {
				const propertyName = getStaticName(node.name);
				if (propertyName && RAW_ESCAPE_PROPERTIES.has(propertyName)) {
					addViolation(file, node, propertyName, "raw Pi escape property");
				}
			}
			if (
				ts.isBinaryExpression(node) &&
				node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
				node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
				(ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))
			) {
				const propertyName = ts.isPropertyAccessExpression(node.left)
					? node.left.name.text
					: getStaticName(node.left.argumentExpression);
				if (propertyName && RAW_ESCAPE_PROPERTIES.has(propertyName)) {
					addViolation(file, node, propertyName, "raw Pi escape property");
				}
			}
			if (ts.isCallExpression(node)) {
				const callTarget = unwrapExpression(node.expression);
				if (!ts.isPropertyAccessExpression(callTarget) && !ts.isElementAccessExpression(callTarget)) {
					ts.forEachChild(node, visit);
					return;
				}
				const methodName = ts.isPropertyAccessExpression(callTarget)
					? callTarget.name.text
					: getStaticName(callTarget.argumentExpression);
				const owner = callTarget.expression;
				const ownerName = ts.isIdentifier(owner)
					? owner.text
					: ts.isPropertyAccessExpression(owner)
						? owner.name.text
						: ts.isElementAccessExpression(owner)
							? getStaticName(owner.argumentExpression)
							: undefined;
				const propertyName = getStaticName(node.arguments[1]);
				if (
					((ownerName === "Object" && methodName === "defineProperty") ||
						(ownerName === "Reflect" && (methodName === "set" || methodName === "defineProperty"))) &&
					propertyName &&
					RAW_ESCAPE_PROPERTIES.has(propertyName)
				) {
					addViolation(file, node, propertyName, "raw Pi escape property");
				}
			}
			ts.forEachChild(node, visit);
		}
		visit(sourceFile);
	}
	return violations;
}

async function checkCompositionBoundary(packageRoot, sourceRoot) {
	let files;
	try {
		files = await collectSourceFiles(sourceRoot);
	} catch (error) {
		if (error?.code === "ENOENT") return [];
		throw error;
	}
	const cliPath = resolve(sourceRoot, "cli.js");
	if (!files.includes(cliPath)) return [];
	const program = ts.createProgram({
		rootNames: files,
		options: {
			allowJs: true,
			checkJs: false,
			module: ts.ModuleKind.NodeNext,
			moduleResolution: ts.ModuleResolutionKind.NodeNext,
			noEmit: true,
			skipLibCheck: true,
			target: ts.ScriptTarget.Latest,
		},
	});
	const checker = program.getTypeChecker();
	const sourceFiles = files.flatMap((file) => {
		const sourceFile = program.getSourceFile(file);
		return sourceFile ? [sourceFile] : [];
	});
	const origins = new Map();

	function getImportDeclaration(declaration) {
		let current = declaration;
		while (current && !ts.isImportDeclaration(current)) current = current.parent;
		return current && ts.isImportDeclaration(current) ? current : undefined;
	}

	function isLocalImport(declaration) {
		const importDeclaration = getImportDeclaration(declaration);
		return (
			importDeclaration !== undefined &&
			ts.isStringLiteralLike(importDeclaration.moduleSpecifier) &&
			importDeclaration.moduleSpecifier.text.startsWith(".")
		);
	}

	function canonicalCreatorOrigin(symbol) {
		const seen = new Set();
		let resolved = symbol;
		while (resolved && (resolved.flags & ts.SymbolFlags.Alias) !== 0) {
			if (seen.has(resolved)) return undefined;
			seen.add(resolved);
			const next = checker.getAliasedSymbol(resolved);
			if (next === resolved) break;
			resolved = next;
		}
		if (!resolved) return undefined;
		const definition = FEATURE_CREATORS.get(resolved.getName());
		if (!definition) return undefined;
		return (resolved.declarations ?? []).some(
			(declaration) =>
				normalizeArchitectureRelativePath(relative(packageRoot, declaration.getSourceFile().fileName)) ===
				definition.source,
		)
			? definition.origin
			: undefined;
	}

	function creatorOrigin(expression, seen = new Set()) {
		const unwrapped = unwrapExpression(expression);
		if (unwrapped !== expression) return creatorOrigin(unwrapped, seen);
		if (ts.isIdentifier(expression)) {
			const symbol = checker.getSymbolAtLocation(expression);
			if (!symbol) return FEATURE_CREATORS.get(expression.text)?.origin;
			const canonical = canonicalCreatorOrigin(symbol);
			if (canonical) return canonical;
			if (seen.has(symbol)) return undefined;
			seen.add(symbol);
			for (const declaration of symbol.declarations ?? []) {
				if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
					const origin = creatorOrigin(declaration.initializer, seen);
					if (origin) return origin;
				}
				if (ts.isBindingElement(declaration)) {
					const creatorName = getStaticName(declaration.propertyName ?? declaration.name);
					const variableDeclaration = declaration.parent.parent;
					if (creatorName && ts.isVariableDeclaration(variableDeclaration) && variableDeclaration.initializer) {
						const property = checker.getTypeAtLocation(variableDeclaration.initializer).getProperty(creatorName);
						const origin = property ? canonicalCreatorOrigin(property) : undefined;
						if (origin) return origin;
					}
				}
			}
			return undefined;
		}
		if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
			const creatorName = ts.isPropertyAccessExpression(expression)
				? expression.name.text
				: getStaticName(expression.argumentExpression);
			if (!creatorName) return undefined;
			const location = ts.isPropertyAccessExpression(expression) ? expression.name : expression.argumentExpression;
			const property =
				checker.getSymbolAtLocation(location) ??
				checker.getTypeAtLocation(expression.expression).getProperty(creatorName);
			return property ? canonicalCreatorOrigin(property) : undefined;
		}
		return undefined;
	}

	function expressionOrigin(expression) {
		const unwrapped = unwrapExpression(expression);
		if (unwrapped !== expression) return expressionOrigin(unwrapped);
		if (ts.isIdentifier(expression)) {
			const symbol = checker.getSymbolAtLocation(expression);
			return symbol ? origins.get(symbol) : FEATURE_INSTANCES.get(expression.text);
		}
		if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
			const propertyName = ts.isPropertyAccessExpression(expression)
				? expression.name.text
				: getStaticName(expression.argumentExpression);
			const owner = expressionOrigin(expression.expression);
			if (propertyName === "extension" && owner?.kind === "controller") {
				return { ...owner, kind: "callable" };
			}
			return origins.get(checker.getSymbolAtLocation(expression));
		}
		if (ts.isCallExpression(expression)) return creatorOrigin(expression.expression);
		return undefined;
	}

	function setOrigin(name, origin) {
		if (!origin) return false;
		const symbol = checker.getSymbolAtLocation(name);
		if (!symbol || origins.has(symbol)) return false;
		origins.set(symbol, origin);
		return true;
	}

	let changed;
	do {
		changed = false;
		for (const sourceFile of sourceFiles) {
			function collect(node) {
				if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
					changed = setOrigin(node.name, expressionOrigin(node.initializer)) || changed;
				} else if (ts.isPropertyAssignment(node)) {
					changed = setOrigin(node.name, expressionOrigin(node.initializer)) || changed;
				} else if (
					ts.isBinaryExpression(node) &&
					node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
					(ts.isIdentifier(node.left) ||
						ts.isPropertyAccessExpression(node.left) ||
						ts.isElementAccessExpression(node.left))
				) {
					changed = setOrigin(node.left, expressionOrigin(node.right)) || changed;
				}
				ts.forEachChild(node, collect);
			}
			collect(sourceFile);
		}
	} while (changed);

	function isPiPortCreator(expression) {
		if (!ts.isIdentifier(expression)) return false;
		const symbol = checker.getSymbolAtLocation(expression);
		for (const declaration of symbol?.declarations ?? []) {
			if (!ts.isImportSpecifier(declaration) || !isLocalImport(declaration)) continue;
			if ((declaration.propertyName ?? declaration.name).text !== "createPiExtensionPorts") continue;
			const importDeclaration = getImportDeclaration(declaration);
			if (
				importDeclaration &&
				ts.isStringLiteralLike(importDeclaration.moduleSpecifier) &&
				/^\.\/adapters\/pi\/pi-runtime-adapter\.(?:js|ts)$/.test(importDeclaration.moduleSpecifier.text)
			) {
				return true;
			}
		}
		return false;
	}

	function getCompositionScope(node) {
		let current = node.parent;
		while (current && !ts.isSourceFile(current) && !ts.isFunctionLike(current)) current = current.parent;
		return current;
	}

	const reassignedSymbols = new Set();
	const portBundleCounts = new Map();
	for (const sourceFile of sourceFiles) {
		function collectPortSources(node) {
			if (
				ts.isBinaryExpression(node) &&
				node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
				node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
				ts.isIdentifier(node.left)
			) {
				const symbol = checker.getSymbolAtLocation(node.left);
				if (symbol) reassignedSymbols.add(symbol);
			}
			if (
				ts.isVariableDeclaration(node) &&
				ts.isIdentifier(node.name) &&
				node.initializer &&
				ts.isCallExpression(node.initializer) &&
				node.initializer.arguments.length === 1 &&
				isPiPortCreator(node.initializer.expression)
			) {
				const scope = getCompositionScope(node);
				if (scope) portBundleCounts.set(scope, (portBundleCounts.get(scope) ?? 0) + 1);
			}
			ts.forEachChild(node, collectPortSources);
		}
		collectPortSources(sourceFile);
	}

	function isExpectedPortArgument(argument, port, call) {
		if (!ts.isPropertyAccessExpression(argument) && !ts.isElementAccessExpression(argument)) return false;
		const propertyName = ts.isPropertyAccessExpression(argument)
			? argument.name.text
			: getStaticName(argument.argumentExpression);
		if (propertyName !== port || !ts.isIdentifier(argument.expression)) return false;
		const symbol = checker.getSymbolAtLocation(argument.expression);
		const declarations = (symbol?.declarations ?? []).filter(
			(declaration) => ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name),
		);
		if (declarations.length !== 1 || (symbol && reassignedSymbols.has(symbol))) return false;
		const [declaration] = declarations;
		const scope = getCompositionScope(declaration);
		if (scope !== getCompositionScope(call) || portBundleCounts.get(scope) !== 1) return false;
		if ((declaration.parent.flags & ts.NodeFlags.Const) === 0 || !declaration.initializer) return false;
		if (!ts.isCallExpression(declaration.initializer) || declaration.initializer.arguments.length !== 1) return false;
		return isPiPortCreator(declaration.initializer.expression);
	}

	function isDeclarationName(node) {
		const parent = node.parent;
		return (
			(ts.isVariableDeclaration(parent) ||
				ts.isPropertyAssignment(parent) ||
				ts.isMethodDeclaration(parent) ||
				ts.isGetAccessorDeclaration(parent) ||
				ts.isSetAccessorDeclaration(parent)) &&
			parent.name === node
		);
	}

	const counts = new Map([...FEATURE_INSTANCES.values()].map((origin) => [origin.displayName, 0]));
	const violations = [];
	for (const sourceFile of sourceFiles) {
		const sourcePath = normalizeArchitectureRelativePath(relative(packageRoot, sourceFile.fileName));
		function visit(node) {
			if (
				sourcePath === COMPOSITION_FILE &&
				(ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
				expressionOrigin(node)?.kind === "callable" &&
				!isDeclarationName(node) &&
				!(ts.isCallExpression(node.parent) && node.parent.expression === node)
			) {
				violations.push({
					file: sourcePath,
					specifier: node.getText(sourceFile),
					reason: "feature capability stored or forwarded outside composition",
				});
			}
			if (ts.isCallExpression(node)) {
				const origin = expressionOrigin(node.expression);
				if (origin?.kind === "callable") {
					counts.set(origin.displayName, (counts.get(origin.displayName) ?? 0) + 1);
					if (
						sourcePath !== COMPOSITION_FILE ||
						node.arguments.length !== 1 ||
						!isExpectedPortArgument(node.arguments[0], origin.port, node)
					) {
						violations.push({
							file: sourcePath,
							specifier: node.getText(sourceFile),
							reason: "raw or incorrect feature capability composition",
						});
					}
				}
			}
			ts.forEachChild(node, visit);
		}
		visit(sourceFile);
	}
	for (const [displayName, count] of counts) {
		const origin = [...FEATURE_INSTANCES.values()].find((candidate) => candidate.displayName === displayName);
		if (count !== 1 && !(count === 0 && origin?.required === false)) {
			violations.push({
				file: COMPOSITION_FILE,
				specifier: `${displayName} count=${count}`,
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
						file: normalizeArchitectureRelativePath(relative(packageRoot, file)),
						specifier: reference.specifier,
						reason: "dynamic implementation import",
					});
					continue;
				}
				const reason = getViolation(file, reference.specifier, sourceRoot);
				if (reason) {
					violations.push({
						file: normalizeArchitectureRelativePath(relative(packageRoot, file)),
						specifier: reference.specifier,
						reason,
					});
				}
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
