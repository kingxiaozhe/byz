import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import chalk from "chalk";
import { CONFIG_DIR_NAME } from "../config.ts";
import { loadThemeFromPath, type Theme } from "../modes/interactive/theme/theme.ts";
import type { ResourceDiagnostic } from "./diagnostics.ts";

export type { ResourceCollision, ResourceDiagnostic } from "./diagnostics.ts";

import { canonicalizePath, isLocalPath, resolvePath } from "../utils/paths.ts";
import { stripBom } from "../utils/text.ts";
import { createEventBus, type EventBus } from "./event-bus.ts";
import {
	clearExtensionCache,
	createExtensionRuntime,
	loadExtensionFromFactory,
	loadExtensionsCached,
} from "./extensions/loader.ts";
import type {
	Extension,
	ExtensionRuntime,
	InlineExtension,
	LoadExtensionsResult,
	ManagedExtensionFactory,
	ManagedResourceCapability,
	ManagedResourcePrecedence,
} from "./extensions/types.ts";
import { findGitPaths } from "./footer-data-provider.ts";
import { DefaultPackageManager, type PathMetadata, type ResolvedResource } from "./package-manager.ts";
import type { PromptTemplate } from "./prompt-templates.ts";
import { loadPromptTemplates } from "./prompt-templates.ts";
import { SettingsManager } from "./settings-manager.ts";
import type { Skill } from "./skills.ts";
import { loadSkills } from "./skills.ts";
import { createSourceInfo, type SourceInfo } from "./source-info.ts";
import { resetTimings } from "./timings.ts";

export interface ResourceExtensionPaths {
	skillPaths?: Array<{ path: string; metadata: PathMetadata; owner?: string }>;
	promptPaths?: Array<{ path: string; metadata: PathMetadata; owner?: string }>;
	themePaths?: Array<{ path: string; metadata: PathMetadata; owner?: string }>;
}

export interface ResourceLoaderReloadOptions {
	resolveProjectTrust?: (input: { extensionsResult: LoadExtensionsResult }) => Promise<boolean>;
}

interface ManagedResourceSnapshot {
	skills: Skill[];
	skillDiagnostics: ResourceDiagnostic[];
	prompts: PromptTemplate[];
	promptDiagnostics: ResourceDiagnostic[];
}

export interface ResourceLoader {
	getExtensions(): LoadExtensionsResult;
	getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
	getPrompts(): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
	getThemes(): { themes: Theme[]; diagnostics: ResourceDiagnostic[] };
	getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> };
	getSystemPrompt(): string | undefined;
	getSystemPromptSource(): { path: string } | undefined;
	getAppendSystemPrompt(): string[];
	getAppendSystemPromptSources(): Array<{ path: string }>;
	extendResources(paths: ResourceExtensionPaths): void;
	registerManagedResourceOwner?(capability: ManagedResourceCapability, owner: string): void;
	replaceManagedResources?(capability: ManagedResourceCapability, owner: string, paths: ResourceExtensionPaths): void;
	beginReloadTransaction?(): { commit(): void; rollback(): void };
	reload(options?: ResourceLoaderReloadOptions): Promise<void>;
}

function resolvePromptInput(input: string | undefined, description: string): string | undefined {
	if (!input) {
		return undefined;
	}

	if (existsSync(input)) {
		try {
			return stripBom(readFileSync(input, "utf-8"));
		} catch (error) {
			console.error(chalk.yellow(`Warning: Could not read ${description} file ${input}: ${error}`));
			return input;
		}
	}

	return input;
}

function loadContextFileFromDir(dir: string): { path: string; content: string } | null {
	const candidates = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
	for (const filename of candidates) {
		const filePath = join(dir, filename);
		if (existsSync(filePath)) {
			try {
				if (!statSync(filePath).isFile()) {
					continue;
				}
				return {
					path: filePath,
					content: stripBom(readFileSync(filePath, "utf-8")),
				};
			} catch (error) {
				console.error(chalk.yellow(`Warning: Could not read ${filePath}: ${error}`));
			}
		}
	}
	return null;
}

/**
 * The main repo's context file that a nested linked worktree's own copy shadows: both
 * occupy the same logical repository scope, so loading both applies that context twice. Returns
 * undefined when nothing is shadowed, leaving normal ancestor inheritance alone.
 *
 * Returned canonicalized (realpath), because `git worktree add` writes the `.git`
 * file's `gitdir:` target in realpath form while cwd may still be symlinked
 * (macOS `/tmp` -> `/private/tmp`).
 */
function findShadowedContextFile(cwd: string): string | undefined {
	const gitPaths = findGitPaths(cwd);
	if (!gitPaths) return undefined;
	const commonGitDir = canonicalizePath(gitPaths.commonGitDir);
	const worktreeRoot = canonicalizePath(gitPaths.repoDir);
	const mainRepoRoot = dirname(commonGitDir);
	// False for an ordinary repo, where the two are the same dir, and for a sibling
	// worktree (`git worktree add ../feat`), whose main repo is not an ancestor.
	if (!worktreeRoot.startsWith(`${mainRepoRoot}${sep}`)) return undefined;
	// dirname of the common git dir is the main worktree root only when that dir is
	// itself checked out from the same repo. In a bare layout (`proj/.bare` +
	// `proj/main`) it is just the directory holding `.bare`, which tracks nothing; a
	// submodule's gitdir has no `commondir`, so it lands under `.git/modules`.
	if (canonicalizePath(join(mainRepoRoot, ".git")) !== commonGitDir) return undefined;
	const worktreeContextFile = loadContextFileFromDir(worktreeRoot);
	return worktreeContextFile ? join(mainRepoRoot, basename(worktreeContextFile.path)) : undefined;
}

export function loadProjectContextFiles(options: {
	cwd: string;
	agentDir: string;
}): Array<{ path: string; content: string }> {
	const resolvedCwd = resolvePath(options.cwd);
	const resolvedAgentDir = resolvePath(options.agentDir);

	const contextFiles: Array<{ path: string; content: string }> = [];
	const seenPaths = new Set<string>();

	const globalContext = loadContextFileFromDir(resolvedAgentDir);
	if (globalContext) {
		contextFiles.push(globalContext);
		seenPaths.add(globalContext.path);
	}

	const ancestorContextFiles: Array<{ path: string; content: string }> = [];

	const shadowedContextFile = findShadowedContextFile(resolvedCwd);
	let currentDir = resolvedCwd;

	while (true) {
		const contextFile = loadContextFileFromDir(currentDir);
		const isShadowed =
			shadowedContextFile !== undefined && canonicalizePath(contextFile?.path ?? "") === shadowedContextFile;
		if (contextFile && !isShadowed && !seenPaths.has(contextFile.path)) {
			ancestorContextFiles.unshift(contextFile);
			seenPaths.add(contextFile.path);
		}

		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) break;
		currentDir = parentDir;
	}

	contextFiles.push(...ancestorContextFiles);

	return contextFiles;
}

export interface DefaultResourceLoaderOptions {
	cwd: string;
	agentDir: string;
	settingsManager?: SettingsManager;
	eventBus?: EventBus;
	additionalExtensionPaths?: string[];
	additionalSkillPaths?: string[];
	additionalPromptTemplatePaths?: string[];
	additionalThemePaths?: string[];
	additionalResourcePrecedence?: "before" | "after";
	extensionFactories?: InlineExtension[];
	managedExtensionFactories?: ManagedExtensionFactory[];
	noExtensions?: boolean;
	noSkills?: boolean;
	noPromptTemplates?: boolean;
	noThemes?: boolean;
	noContextFiles?: boolean;
	systemPrompt?: string;
	appendSystemPrompt?: string[];
	extensionsOverride?: (base: LoadExtensionsResult) => LoadExtensionsResult;
	skillsOverride?: (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
		skills: Skill[];
		diagnostics: ResourceDiagnostic[];
	};
	promptsOverride?: (base: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] }) => {
		prompts: PromptTemplate[];
		diagnostics: ResourceDiagnostic[];
	};
	themesOverride?: (base: { themes: Theme[]; diagnostics: ResourceDiagnostic[] }) => {
		themes: Theme[];
		diagnostics: ResourceDiagnostic[];
	};
	agentsFilesOverride?: (base: { agentsFiles: Array<{ path: string; content: string }> }) => {
		agentsFiles: Array<{ path: string; content: string }>;
	};
	systemPromptOverride?: (base: string | undefined) => string | undefined;
	appendSystemPromptOverride?: (base: string[]) => string[];
}

export class DefaultResourceLoader implements ResourceLoader {
	private cwd: string;
	private agentDir: string;
	private settingsManager: SettingsManager;
	private eventBus: EventBus;
	private packageManager: DefaultPackageManager;
	private additionalExtensionPaths: string[];
	private additionalSkillPaths: string[];
	private additionalPromptTemplatePaths: string[];
	private additionalThemePaths: string[];
	private additionalResourcePrecedence: "before" | "after";
	private extensionFactories: InlineExtension[];
	private managedExtensionFactories: ManagedExtensionFactory[];
	private noExtensions: boolean;
	private noSkills: boolean;
	private noPromptTemplates: boolean;
	private noThemes: boolean;
	private noContextFiles: boolean;
	private systemPromptSource?: string;
	private appendSystemPromptSource?: string[];
	private extensionsOverride?: (base: LoadExtensionsResult) => LoadExtensionsResult;
	private skillsOverride?: (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
		skills: Skill[];
		diagnostics: ResourceDiagnostic[];
	};
	private promptsOverride?: (base: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] }) => {
		prompts: PromptTemplate[];
		diagnostics: ResourceDiagnostic[];
	};
	private themesOverride?: (base: { themes: Theme[]; diagnostics: ResourceDiagnostic[] }) => {
		themes: Theme[];
		diagnostics: ResourceDiagnostic[];
	};
	private agentsFilesOverride?: (base: { agentsFiles: Array<{ path: string; content: string }> }) => {
		agentsFiles: Array<{ path: string; content: string }>;
	};
	private systemPromptOverride?: (base: string | undefined) => string | undefined;
	private appendSystemPromptOverride?: (base: string[]) => string[];

	private extensionsResult: LoadExtensionsResult;
	private skills: Skill[];
	private skillDiagnostics: ResourceDiagnostic[];
	private prompts: PromptTemplate[];
	private promptDiagnostics: ResourceDiagnostic[];
	private themes: Theme[];
	private themeDiagnostics: ResourceDiagnostic[];
	private agentsFiles: Array<{ path: string; content: string }>;
	private systemPrompt?: string;
	private systemPromptSourcePath?: string;
	private appendSystemPrompt: string[];
	private appendSystemPromptSourcePaths: string[];
	private lastSkillPaths: string[];
	private extensionSkillSourceInfos: Map<string, SourceInfo>;
	private extensionPromptSourceInfos: Map<string, SourceInfo>;
	private extensionThemeSourceInfos: Map<string, SourceInfo>;
	private extensionSkillOwners: Map<string, string>;
	private extensionPromptOwners: Map<string, string>;
	private extensionThemeOwners: Map<string, string>;
	private managedResourceCapabilities: Map<
		ManagedResourceCapability,
		{ owner?: string; precedence: ManagedResourcePrecedence }
	>;
	private managedResourceSnapshots: Map<string, ManagedResourceSnapshot>;
	private extensionResourceBaselines: Map<string, ManagedResourceSnapshot>;
	private resourceMetadataByPath: Map<string, PathMetadata>;
	private lastPromptPaths: string[];
	private lastThemePaths: string[];
	private loaded: boolean;

	constructor(options: DefaultResourceLoaderOptions) {
		this.cwd = resolvePath(options.cwd);
		this.agentDir = resolvePath(options.agentDir);
		this.settingsManager = options.settingsManager ?? SettingsManager.create(this.cwd, this.agentDir);
		this.eventBus = options.eventBus ?? createEventBus();
		this.packageManager = new DefaultPackageManager({
			cwd: this.cwd,
			agentDir: this.agentDir,
			settingsManager: this.settingsManager,
		});
		this.additionalExtensionPaths = options.additionalExtensionPaths ?? [];
		this.additionalSkillPaths = options.additionalSkillPaths ?? [];
		this.additionalPromptTemplatePaths = options.additionalPromptTemplatePaths ?? [];
		this.additionalThemePaths = options.additionalThemePaths ?? [];
		this.additionalResourcePrecedence = options.additionalResourcePrecedence ?? "after";
		this.extensionFactories = options.extensionFactories ?? [];
		this.managedExtensionFactories = options.managedExtensionFactories ?? [];
		this.noExtensions = options.noExtensions ?? false;
		this.noSkills = options.noSkills ?? false;
		this.noPromptTemplates = options.noPromptTemplates ?? false;
		this.noThemes = options.noThemes ?? false;
		this.noContextFiles = options.noContextFiles ?? false;
		this.systemPromptSource = options.systemPrompt;
		this.appendSystemPromptSource = options.appendSystemPrompt;
		this.extensionsOverride = options.extensionsOverride;
		this.skillsOverride = options.skillsOverride;
		this.promptsOverride = options.promptsOverride;
		this.themesOverride = options.themesOverride;
		this.agentsFilesOverride = options.agentsFilesOverride;
		this.systemPromptOverride = options.systemPromptOverride;
		this.appendSystemPromptOverride = options.appendSystemPromptOverride;

		this.extensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() };
		this.skills = [];
		this.skillDiagnostics = [];
		this.prompts = [];
		this.promptDiagnostics = [];
		this.themes = [];
		this.themeDiagnostics = [];
		this.agentsFiles = [];
		this.appendSystemPrompt = [];
		this.appendSystemPromptSourcePaths = [];
		this.lastSkillPaths = [];
		this.extensionSkillSourceInfos = new Map();
		this.extensionPromptSourceInfos = new Map();
		this.extensionThemeSourceInfos = new Map();
		this.extensionSkillOwners = new Map();
		this.extensionPromptOwners = new Map();
		this.extensionThemeOwners = new Map();
		this.managedResourceCapabilities = new Map();
		this.managedResourceSnapshots = new Map();
		this.extensionResourceBaselines = new Map();
		this.resourceMetadataByPath = new Map();
		this.lastPromptPaths = [];
		this.lastThemePaths = [];
		this.loaded = false;
	}

	getExtensions(): LoadExtensionsResult {
		return this.extensionsResult;
	}

	getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } {
		return { skills: this.skills, diagnostics: this.skillDiagnostics };
	}

	getPrompts(): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] } {
		return { prompts: this.prompts, diagnostics: this.promptDiagnostics };
	}

	getThemes(): { themes: Theme[]; diagnostics: ResourceDiagnostic[] } {
		return { themes: this.themes, diagnostics: this.themeDiagnostics };
	}

	getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> } {
		return { agentsFiles: this.agentsFiles };
	}

	getSystemPrompt(): string | undefined {
		return this.systemPrompt;
	}

	getSystemPromptSource(): { path: string } | undefined {
		return this.systemPromptSourcePath ? { path: this.systemPromptSourcePath } : undefined;
	}

	getAppendSystemPrompt(): string[] {
		return this.appendSystemPrompt;
	}

	getAppendSystemPromptSources(): Array<{ path: string }> {
		return this.appendSystemPromptSourcePaths.map((path) => ({ path }));
	}

	beginReloadTransaction(): { commit(): void; rollback(): void } {
		const snapshot = {
			extensionsResult: this.extensionsResult,
			skills: this.skills,
			skillDiagnostics: this.skillDiagnostics,
			prompts: this.prompts,
			promptDiagnostics: this.promptDiagnostics,
			themes: this.themes,
			themeDiagnostics: this.themeDiagnostics,
			agentsFiles: this.agentsFiles,
			systemPrompt: this.systemPrompt,
			systemPromptSourcePath: this.systemPromptSourcePath,
			appendSystemPrompt: this.appendSystemPrompt,
			appendSystemPromptSourcePaths: this.appendSystemPromptSourcePaths,
			lastSkillPaths: this.lastSkillPaths,
			extensionSkillSourceInfos: this.extensionSkillSourceInfos,
			extensionPromptSourceInfos: this.extensionPromptSourceInfos,
			extensionThemeSourceInfos: this.extensionThemeSourceInfos,
			extensionSkillOwners: this.extensionSkillOwners,
			extensionPromptOwners: this.extensionPromptOwners,
			extensionThemeOwners: this.extensionThemeOwners,
			managedResourceCapabilities: this.managedResourceCapabilities,
			managedResourceSnapshots: this.managedResourceSnapshots,
			extensionResourceBaselines: this.extensionResourceBaselines,
			resourceMetadataByPath: this.resourceMetadataByPath,
			lastPromptPaths: this.lastPromptPaths,
			lastThemePaths: this.lastThemePaths,
			loaded: this.loaded,
		};
		let active = true;
		return {
			commit: () => {
				if (!active) throw new Error("Resource reload transaction is already closed.");
				active = false;
			},
			rollback: () => {
				if (!active) throw new Error("Resource reload transaction is already closed.");
				this.extensionsResult = snapshot.extensionsResult;
				this.skills = snapshot.skills;
				this.skillDiagnostics = snapshot.skillDiagnostics;
				this.prompts = snapshot.prompts;
				this.promptDiagnostics = snapshot.promptDiagnostics;
				this.themes = snapshot.themes;
				this.themeDiagnostics = snapshot.themeDiagnostics;
				this.agentsFiles = snapshot.agentsFiles;
				this.systemPrompt = snapshot.systemPrompt;
				this.systemPromptSourcePath = snapshot.systemPromptSourcePath;
				this.appendSystemPrompt = snapshot.appendSystemPrompt;
				this.appendSystemPromptSourcePaths = snapshot.appendSystemPromptSourcePaths;
				this.lastSkillPaths = snapshot.lastSkillPaths;
				this.extensionSkillSourceInfos = snapshot.extensionSkillSourceInfos;
				this.extensionPromptSourceInfos = snapshot.extensionPromptSourceInfos;
				this.extensionThemeSourceInfos = snapshot.extensionThemeSourceInfos;
				this.extensionSkillOwners = snapshot.extensionSkillOwners;
				this.extensionPromptOwners = snapshot.extensionPromptOwners;
				this.extensionThemeOwners = snapshot.extensionThemeOwners;
				this.managedResourceCapabilities = snapshot.managedResourceCapabilities;
				this.managedResourceSnapshots = snapshot.managedResourceSnapshots;
				this.extensionResourceBaselines = snapshot.extensionResourceBaselines;
				this.resourceMetadataByPath = snapshot.resourceMetadataByPath;
				this.lastPromptPaths = snapshot.lastPromptPaths;
				this.lastThemePaths = snapshot.lastThemePaths;
				this.loaded = snapshot.loaded;
				active = false;
			},
		};
	}

	extendResources(paths: ResourceExtensionPaths): void {
		const skillPaths = this.normalizeExtensionPaths(paths.skillPaths ?? []);
		const promptPaths = this.normalizeExtensionPaths(paths.promptPaths ?? []);
		const themePaths = this.normalizeExtensionPaths(paths.themePaths ?? []);

		const managedOwners = new Set(
			[...this.managedResourceCapabilities.values()]
				.map((entry) => entry.owner)
				.filter((owner): owner is string => owner !== undefined),
		);
		if (managedOwners.size === 0) {
			this.extendNormalizedResources({ skillPaths, promptPaths, themePaths });
			return;
		}
		if (themePaths.some((entry) => entry.owner && managedOwners.has(entry.owner))) {
			throw new Error("Managed resource updates support skills and prompts only.");
		}

		this.extendNormalizedResources({
			skillPaths: skillPaths.filter((entry) => !entry.owner || !managedOwners.has(entry.owner)),
			promptPaths: promptPaths.filter((entry) => !entry.owner || !managedOwners.has(entry.owner)),
			themePaths: themePaths.filter((entry) => !entry.owner || !managedOwners.has(entry.owner)),
		});
		for (const owner of managedOwners) {
			this.extensionResourceBaselines.set(owner, {
				skills: this.skills,
				skillDiagnostics: this.skillDiagnostics,
				prompts: this.prompts,
				promptDiagnostics: this.promptDiagnostics,
			});
		}
		const managedSkillPaths = skillPaths.filter((entry) => entry.owner && managedOwners.has(entry.owner));
		const managedPromptPaths = promptPaths.filter((entry) => entry.owner && managedOwners.has(entry.owner));
		this.extendNormalizedResources({
			skillPaths: managedSkillPaths,
			promptPaths: managedPromptPaths,
			themePaths: [],
		});
		for (const owner of managedOwners) {
			this.managedResourceSnapshots.set(
				owner,
				this.loadManagedResourceSnapshot(
					managedSkillPaths.filter((entry) => entry.owner === owner),
					managedPromptPaths.filter((entry) => entry.owner === owner),
				),
			);
		}
		const base = this.extensionResourceBaselines.values().next().value;
		if (base) this.applyManagedResourceSnapshots(base);
	}

	private extendNormalizedResources(paths: Required<ResourceExtensionPaths>): void {
		const { skillPaths, promptPaths, themePaths } = paths;
		const mergeExtensionPaths = (currentPaths: string[], entries: typeof skillPaths): string[] => {
			const priorityPaths: string[] = [];
			const regularPaths: string[] = [];
			for (const entry of entries) {
				const managed = entry.owner ? this.getManagedResourceOwner(entry.owner) : undefined;
				(managed?.precedence === "before" ? priorityPaths : regularPaths).push(entry.path);
			}
			return this.mergePaths(priorityPaths, this.mergePaths(currentPaths, regularPaths));
		};

		for (const entry of skillPaths) {
			this.extensionSkillSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
			if (entry.owner) this.extensionSkillOwners.set(entry.path, entry.owner);
		}
		for (const entry of promptPaths) {
			this.extensionPromptSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
			if (entry.owner) this.extensionPromptOwners.set(entry.path, entry.owner);
		}
		for (const entry of themePaths) {
			this.extensionThemeSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
			if (entry.owner) this.extensionThemeOwners.set(entry.path, entry.owner);
		}

		if (skillPaths.length > 0) {
			this.lastSkillPaths = mergeExtensionPaths(this.lastSkillPaths, skillPaths);
			this.updateSkillsFromPaths(this.lastSkillPaths, this.resourceMetadataByPath);
		}

		if (promptPaths.length > 0) {
			this.lastPromptPaths = mergeExtensionPaths(this.lastPromptPaths, promptPaths);
			this.updatePromptsFromPaths(this.lastPromptPaths, this.resourceMetadataByPath);
		}

		if (themePaths.length > 0) {
			this.lastThemePaths = this.mergePaths(
				this.lastThemePaths,
				themePaths.map((entry) => entry.path),
			);
			this.updateThemesFromPaths(this.lastThemePaths, this.resourceMetadataByPath);
		}
	}

	private loadManagedResourceSnapshot(
		skillPaths: Array<{ path: string; metadata: PathMetadata; owner?: string }>,
		promptPaths: Array<{ path: string; metadata: PathMetadata; owner?: string }>,
		skillSourceInfos = this.extensionSkillSourceInfos,
		promptSourceInfos = this.extensionPromptSourceInfos,
	): ManagedResourceSnapshot {
		let skills = loadSkills({
			cwd: this.cwd,
			agentDir: this.agentDir,
			skillPaths: skillPaths.map((entry) => entry.path),
			includeDefaults: false,
		});
		skills = this.skillsOverride ? this.skillsOverride(skills) : skills;
		const mappedSkills = skills.skills.map((skill) => ({
			...skill,
			sourceInfo:
				this.findSourceInfoForPath(skill.filePath, skillSourceInfos, this.resourceMetadataByPath) ??
				skill.sourceInfo,
		}));
		let prompts = this.dedupePrompts(
			loadPromptTemplates({
				cwd: this.cwd,
				agentDir: this.agentDir,
				promptPaths: promptPaths.map((entry) => entry.path),
				includeDefaults: false,
			}),
		);
		prompts = this.promptsOverride ? this.promptsOverride(prompts) : prompts;
		return {
			skills: mappedSkills,
			skillDiagnostics: skills.diagnostics,
			prompts: prompts.prompts.map((prompt) => ({
				...prompt,
				sourceInfo:
					this.findSourceInfoForPath(prompt.filePath, promptSourceInfos, this.resourceMetadataByPath) ??
					prompt.sourceInfo,
			})),
			promptDiagnostics: prompts.diagnostics,
		};
	}

	private applyManagedResourceSnapshots(base: ManagedResourceSnapshot): void {
		const before: ManagedResourceSnapshot[] = [];
		const after: ManagedResourceSnapshot[] = [];
		for (const managed of this.managedResourceCapabilities.values()) {
			if (!managed.owner) continue;
			const snapshot = this.managedResourceSnapshots.get(managed.owner);
			if (snapshot) (managed.precedence === "before" ? before : after).push(snapshot);
		}
		const orderedSnapshots = [...before, base, ...after];
		const skillsByName = new Map<string, Skill>();
		const collisionDiagnostics: ResourceDiagnostic[] = [];
		for (const skill of orderedSnapshots.flatMap((snapshot) => snapshot.skills)) {
			const existing = skillsByName.get(skill.name);
			if (!existing) {
				skillsByName.set(skill.name, skill);
				continue;
			}
			collisionDiagnostics.push({
				type: "collision",
				message: `name "${skill.name}" collision`,
				path: skill.filePath,
				collision: {
					resourceType: "skill",
					name: skill.name,
					winnerPath: existing.filePath,
					loserPath: skill.filePath,
				},
			});
		}
		const prompts = this.dedupePrompts(orderedSnapshots.flatMap((snapshot) => snapshot.prompts));
		this.skills = [...skillsByName.values()];
		this.skillDiagnostics = [
			...orderedSnapshots.flatMap((snapshot) => snapshot.skillDiagnostics),
			...collisionDiagnostics,
		];
		this.prompts = prompts.prompts;
		this.promptDiagnostics = [
			...orderedSnapshots.flatMap((snapshot) => snapshot.promptDiagnostics),
			...prompts.diagnostics,
		];
	}

	private getManagedResourceOwner(
		owner: string,
	): { capability: ManagedResourceCapability; precedence: ManagedResourcePrecedence } | undefined {
		for (const [capability, entry] of this.managedResourceCapabilities) {
			if (entry.owner === owner) return { capability, precedence: entry.precedence };
		}
		return undefined;
	}

	registerManagedResourceOwner(capability: ManagedResourceCapability, owner: string): void {
		const registered = this.managedResourceCapabilities.get(capability);
		if (!registered) throw new Error("Invalid managed resource capability.");
		if (registered.owner !== undefined && registered.owner !== owner) {
			throw new Error("Managed resource capability is already bound to another extension.");
		}
		registered.owner = owner;
		this.extensionResourceBaselines.set(owner, {
			skills: this.skills,
			skillDiagnostics: this.skillDiagnostics,
			prompts: this.prompts,
			promptDiagnostics: this.promptDiagnostics,
		});
	}

	replaceManagedResources(capability: ManagedResourceCapability, owner: string, paths: ResourceExtensionPaths): void {
		const skillPaths = this.normalizeExtensionPaths(paths.skillPaths ?? []);
		const promptPaths = this.normalizeExtensionPaths(paths.promptPaths ?? []);
		const themePaths = this.normalizeExtensionPaths(paths.themePaths ?? []);
		const managed = this.managedResourceCapabilities.get(capability);
		if (!managed || managed.owner !== owner) {
			throw new Error("Invalid managed resource capability for this extension owner.");
		}
		if (themePaths.length > 0) {
			throw new Error("Managed resource updates support skills and prompts only.");
		}
		if ([...skillPaths, ...promptPaths].some((entry) => entry.owner !== owner)) {
			throw new Error("Managed resource updates must contain only resources owned by the calling extension.");
		}

		const ownedSkillRoots = [...this.extensionSkillOwners.entries()]
			.filter((entry) => entry[1] === owner)
			.map((entry) => entry[0]);
		const ownedPromptRoots = [...this.extensionPromptOwners.entries()]
			.filter((entry) => entry[1] === owner)
			.map((entry) => entry[0]);
		const belongsToRoots = (path: string | undefined, roots: string[]): boolean =>
			path !== undefined && roots.some((root) => this.isUnderPath(resolve(path), root));
		const diagnosticBelongsToRoots = (diagnostic: ResourceDiagnostic, roots: string[]): boolean =>
			belongsToRoots(diagnostic.path, roots) ||
			belongsToRoots(diagnostic.collision?.winnerPath, roots) ||
			belongsToRoots(diagnostic.collision?.loserPath, roots);
		const baseline = this.extensionResourceBaselines.get(owner) ?? {
			skills: this.skills.filter((skill) => !belongsToRoots(skill.filePath, ownedSkillRoots)),
			skillDiagnostics: this.skillDiagnostics.filter(
				(diagnostic) => !diagnosticBelongsToRoots(diagnostic, ownedSkillRoots),
			),
			prompts: this.prompts.filter((prompt) => !belongsToRoots(prompt.filePath, ownedPromptRoots)),
			promptDiagnostics: this.promptDiagnostics.filter(
				(diagnostic) => !diagnosticBelongsToRoots(diagnostic, ownedPromptRoots),
			),
		};
		this.extensionResourceBaselines.set(owner, baseline);

		const nextSkillSourceInfos = new Map(this.extensionSkillSourceInfos);
		const nextPromptSourceInfos = new Map(this.extensionPromptSourceInfos);
		const nextSkillOwners = new Map(this.extensionSkillOwners);
		const nextPromptOwners = new Map(this.extensionPromptOwners);
		const replacePaths = (
			currentPaths: string[],
			currentSourceInfos: Map<string, SourceInfo>,
			currentOwners: Map<string, string>,
			entries: Array<{ path: string; metadata: PathMetadata; owner?: string }>,
		): string[] => {
			let insertionIndex = managed.precedence === "before" ? 0 : currentPaths.length;
			const retainedPaths = currentPaths.filter((path, index) => {
				if (currentOwners.get(path) !== owner) return true;
				insertionIndex = Math.min(insertionIndex, index);
				currentSourceInfos.delete(path);
				currentOwners.delete(path);
				return false;
			});
			const replacementPaths = entries.map((entry) => {
				currentSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
				currentOwners.set(entry.path, owner);
				return entry.path;
			});
			const nextPaths = [
				...retainedPaths.slice(0, insertionIndex),
				...replacementPaths,
				...retainedPaths.slice(insertionIndex),
			];
			return this.mergePaths(nextPaths, []);
		};

		const nextSkillPaths = replacePaths(this.lastSkillPaths, nextSkillSourceInfos, nextSkillOwners, skillPaths);
		const nextPromptPaths = replacePaths(this.lastPromptPaths, nextPromptSourceInfos, nextPromptOwners, promptPaths);
		this.extensionSkillSourceInfos = nextSkillSourceInfos;
		this.extensionPromptSourceInfos = nextPromptSourceInfos;
		this.extensionSkillOwners = nextSkillOwners;
		this.extensionPromptOwners = nextPromptOwners;
		this.lastSkillPaths = nextSkillPaths;
		this.lastPromptPaths = nextPromptPaths;
		this.managedResourceSnapshots.set(
			owner,
			this.loadManagedResourceSnapshot(skillPaths, promptPaths, nextSkillSourceInfos, nextPromptSourceInfos),
		);
		this.applyManagedResourceSnapshots(baseline);
	}

	async loadProjectTrustExtensions(): Promise<LoadExtensionsResult> {
		// Force untrusted project settings for the bootstrap pass. This keeps project-local
		// extensions/packages out while still loading user/global and temporary CLI extensions.
		this.settingsManager.setProjectTrusted(false);
		await this.settingsManager.reload();
		return this.loadCurrentExtensionSet({ includeInlineFactories: true });
	}

	async reload(options?: ResourceLoaderReloadOptions): Promise<void> {
		resetTimings("extensions");

		if (this.loaded) {
			clearExtensionCache();
		}
		// Managed inline factories may be loaded during the project-trust prepass.
		// Clear before that pass so its fresh capability remains registered for the final reused extension.
		this.managedResourceCapabilities = new Map();

		let preTrustExtensions: LoadExtensionsResult | undefined;
		if (options?.resolveProjectTrust) {
			preTrustExtensions = await this.loadProjectTrustExtensions();
			const projectTrusted = await options.resolveProjectTrust({ extensionsResult: preTrustExtensions });
			this.settingsManager.setProjectTrusted(projectTrusted);
		}

		// reload() preserves SettingsManager.projectTrusted and reloads settings for that trust state.
		await this.settingsManager.reload();
		const resolvedPaths = await this.packageManager.resolve();
		const cliExtensionPaths = await this.packageManager.resolveExtensionSources(this.additionalExtensionPaths, {
			temporary: true,
		});
		// Kept on the instance so post-reload passes (extendResources) can still resolve package metadata.
		this.resourceMetadataByPath = new Map();
		const metadataByPath = this.resourceMetadataByPath;

		this.extensionSkillSourceInfos = new Map();
		this.extensionPromptSourceInfos = new Map();
		this.extensionThemeSourceInfos = new Map();
		this.extensionSkillOwners = new Map();
		this.extensionPromptOwners = new Map();
		this.extensionThemeOwners = new Map();
		this.managedResourceSnapshots = new Map();
		this.extensionResourceBaselines = new Map();

		// Helper to extract enabled paths and store metadata
		const getEnabledResources = (resources: ResolvedResource[]): ResolvedResource[] => {
			for (const r of resources) {
				if (!metadataByPath.has(r.path)) {
					metadataByPath.set(r.path, r.metadata);
				}
			}
			return resources.filter((r) => r.enabled);
		};

		const getEnabledPaths = (resources: ResolvedResource[]): string[] =>
			getEnabledResources(resources).map((r) => r.path);
		const enabledExtensions = getEnabledPaths(resolvedPaths.extensions);
		const enabledSkillResources = getEnabledResources(resolvedPaths.skills);
		const enabledPrompts = getEnabledPaths(resolvedPaths.prompts);
		const enabledThemes = getEnabledPaths(resolvedPaths.themes);

		const enabledSkills = enabledSkillResources.map((resource) => this.mapSkillPath(resource, metadataByPath));

		// Add CLI paths metadata
		for (const r of cliExtensionPaths.extensions) {
			if (!metadataByPath.has(r.path)) {
				metadataByPath.set(r.path, { source: "cli", scope: "temporary", origin: "top-level" });
			}
		}
		for (const r of cliExtensionPaths.skills) {
			if (!metadataByPath.has(r.path)) {
				metadataByPath.set(r.path, { source: "cli", scope: "temporary", origin: "top-level" });
			}
		}

		const cliEnabledExtensions = getEnabledPaths(cliExtensionPaths.extensions);
		const cliEnabledSkills = getEnabledPaths(cliExtensionPaths.skills);
		const cliEnabledPrompts = getEnabledPaths(cliExtensionPaths.prompts);
		const cliEnabledThemes = getEnabledPaths(cliExtensionPaths.themes);

		const extensionPaths = this.noExtensions
			? cliEnabledExtensions
			: this.mergePaths(cliEnabledExtensions, enabledExtensions);

		const extensionsResult = await this.loadFinalExtensionSet(extensionPaths, preTrustExtensions);
		for (const p of this.additionalExtensionPaths) {
			if (isLocalPath(p)) {
				const resolved = this.resolveResourcePath(p);
				if (!existsSync(resolved)) {
					extensionsResult.errors.push({ path: resolved, error: `Extension path does not exist: ${resolved}` });
				}
			}
		}
		this.extensionsResult = this.extensionsOverride ? this.extensionsOverride(extensionsResult) : extensionsResult;
		this.applyExtensionSourceInfo(this.extensionsResult.extensions, metadataByPath);

		const skillPaths = this.noSkills
			? this.mergePaths(cliEnabledSkills, this.additionalSkillPaths)
			: this.mergeDiscoverableResourcePaths([...cliEnabledSkills, ...enabledSkills], this.additionalSkillPaths);

		this.lastSkillPaths = skillPaths;
		this.updateSkillsFromPaths(skillPaths, metadataByPath);
		for (const p of this.additionalSkillPaths) {
			if (isLocalPath(p)) {
				const resolved = this.resolveResourcePath(p);
				if (!existsSync(resolved) && !this.skillDiagnostics.some((d) => d.path === resolved)) {
					this.skillDiagnostics.push({ type: "error", message: "Skill path does not exist", path: resolved });
				}
			}
		}

		const promptPaths = this.noPromptTemplates
			? this.mergePaths(cliEnabledPrompts, this.additionalPromptTemplatePaths)
			: this.mergeDiscoverableResourcePaths(
					[...cliEnabledPrompts, ...enabledPrompts],
					this.additionalPromptTemplatePaths,
				);

		this.lastPromptPaths = promptPaths;
		this.updatePromptsFromPaths(promptPaths, metadataByPath);
		for (const p of this.additionalPromptTemplatePaths) {
			if (isLocalPath(p)) {
				const resolved = this.resolveResourcePath(p);
				if (!existsSync(resolved) && !this.promptDiagnostics.some((d) => d.path === resolved)) {
					this.promptDiagnostics.push({
						type: "error",
						message: "Prompt template path does not exist",
						path: resolved,
					});
				}
			}
		}

		const themePaths = this.noThemes
			? this.mergePaths(cliEnabledThemes, this.additionalThemePaths)
			: this.mergePaths([...cliEnabledThemes, ...enabledThemes], this.additionalThemePaths);

		this.lastThemePaths = themePaths;
		this.updateThemesFromPaths(themePaths, metadataByPath);
		for (const p of this.additionalThemePaths) {
			const resolved = this.resolveResourcePath(p);
			if (!existsSync(resolved) && !this.themeDiagnostics.some((d) => d.path === resolved)) {
				this.themeDiagnostics.push({ type: "error", message: "Theme path does not exist", path: resolved });
			}
		}

		const agentsFiles = {
			agentsFiles: this.noContextFiles
				? []
				: loadProjectContextFiles({
						cwd: this.cwd,
						agentDir: this.agentDir,
					}),
		};
		const resolvedAgentsFiles = this.agentsFilesOverride ? this.agentsFilesOverride(agentsFiles) : agentsFiles;
		this.agentsFiles = resolvedAgentsFiles.agentsFiles;

		const systemPromptSource = this.systemPromptSource ?? this.discoverSystemPromptFile();
		const baseSystemPrompt = resolvePromptInput(systemPromptSource, "system prompt");
		this.systemPrompt = this.systemPromptOverride ? this.systemPromptOverride(baseSystemPrompt) : baseSystemPrompt;
		this.systemPromptSourcePath =
			systemPromptSource && existsSync(systemPromptSource) ? resolvePath(systemPromptSource) : undefined;

		let appendSources = this.appendSystemPromptSource;
		if (!appendSources) {
			const discoveredAppendSystemPromptFile = this.discoverAppendSystemPromptFile();
			appendSources = discoveredAppendSystemPromptFile ? [discoveredAppendSystemPromptFile] : [];
		}
		const baseAppend = appendSources
			.map((s) => resolvePromptInput(s, "append system prompt"))
			.filter((s): s is string => s !== undefined);
		this.appendSystemPrompt = this.appendSystemPromptOverride
			? this.appendSystemPromptOverride(baseAppend)
			: baseAppend;
		this.appendSystemPromptSourcePaths = appendSources
			.filter((source) => existsSync(source))
			.map((source) => resolvePath(source));
		this.loaded = true;
	}

	private async loadCurrentExtensionSet(options: { includeInlineFactories: boolean }): Promise<LoadExtensionsResult> {
		const resolvedPaths = await this.packageManager.resolve();
		const cliExtensionPaths = await this.packageManager.resolveExtensionSources(this.additionalExtensionPaths, {
			temporary: true,
		});
		const enabledExtensions = resolvedPaths.extensions.filter((r) => r.enabled).map((r) => r.path);
		const cliEnabledExtensions = cliExtensionPaths.extensions.filter((r) => r.enabled).map((r) => r.path);
		const extensionPaths = this.noExtensions
			? cliEnabledExtensions
			: this.mergePaths(cliEnabledExtensions, enabledExtensions);
		const extensionsResult = await loadExtensionsCached(extensionPaths, this.cwd, this.eventBus);
		if (!options.includeInlineFactories) {
			return extensionsResult;
		}

		const inlineExtensions = await this.loadExtensionFactories(extensionsResult.runtime);
		extensionsResult.extensions.push(...inlineExtensions.extensions);
		extensionsResult.errors.push(...inlineExtensions.errors);
		return extensionsResult;
	}

	private resolveExtensionLoadPath(path: string): string {
		return resolvePath(path, this.cwd, { normalizeUnicodeSpaces: true });
	}

	private async loadFinalExtensionSet(
		extensionPaths: string[],
		preTrustExtensions: LoadExtensionsResult | undefined,
	): Promise<LoadExtensionsResult> {
		if (!preTrustExtensions) {
			const extensionsResult = await loadExtensionsCached(extensionPaths, this.cwd, this.eventBus);
			const inlineExtensions = await this.loadExtensionFactories(extensionsResult.runtime);
			extensionsResult.extensions.push(...inlineExtensions.extensions);
			extensionsResult.errors.push(...inlineExtensions.errors);
			this.addExtensionConflictDiagnostics(extensionsResult);
			return extensionsResult;
		}

		const preloadedByPath = new Map(
			preTrustExtensions.extensions
				.filter((extension) => !extension.path.startsWith("<inline:"))
				.map((extension) => [extension.resolvedPath, extension]),
		);
		const failedPreloadPaths = new Set(
			preTrustExtensions.errors.map((error) => this.resolveExtensionLoadPath(error.path)),
		);
		const remainingPaths = extensionPaths.filter((path) => {
			const resolvedPath = this.resolveExtensionLoadPath(path);
			return !preloadedByPath.has(resolvedPath) && !failedPreloadPaths.has(resolvedPath);
		});
		const remainingExtensions = await loadExtensionsCached(
			remainingPaths,
			this.cwd,
			this.eventBus,
			preTrustExtensions.runtime,
		);
		const loadedByPath = new Map(preloadedByPath);
		for (const extension of remainingExtensions.extensions) {
			loadedByPath.set(extension.resolvedPath, extension);
		}

		const inlineExtensions = preTrustExtensions.extensions.filter((extension) =>
			extension.path.startsWith("<inline:"),
		);
		const orderedExtensions = extensionPaths
			.map((path) => loadedByPath.get(this.resolveExtensionLoadPath(path)))
			.filter((extension): extension is Extension => extension !== undefined);
		orderedExtensions.push(...inlineExtensions);

		const extensionsResult: LoadExtensionsResult = {
			extensions: orderedExtensions,
			errors: [...preTrustExtensions.errors, ...remainingExtensions.errors],
			runtime: preTrustExtensions.runtime,
		};
		this.addExtensionConflictDiagnostics(extensionsResult);
		return extensionsResult;
	}

	private addExtensionConflictDiagnostics(extensionsResult: LoadExtensionsResult): void {
		// Detect extension conflicts (tools, commands, flags with same names from different extensions)
		// Keep all extensions loaded. Conflicts are reported as diagnostics, and precedence is handled by load order.
		const conflicts = this.detectExtensionConflicts(extensionsResult.extensions);
		for (const conflict of conflicts) {
			extensionsResult.errors.push({ path: conflict.path, error: conflict.message });
		}
	}

	private mapSkillPath(resource: ResolvedResource, metadataByPath: Map<string, PathMetadata>): string {
		if (resource.metadata.source !== "auto" && resource.metadata.origin !== "package") {
			return resource.path;
		}
		try {
			const stats = statSync(resource.path);
			if (!stats.isDirectory()) {
				return resource.path;
			}
		} catch {
			return resource.path;
		}
		const skillFile = join(resource.path, "SKILL.md");
		if (existsSync(skillFile)) {
			if (!metadataByPath.has(skillFile)) {
				metadataByPath.set(skillFile, resource.metadata);
			}
			return skillFile;
		}
		return resource.path;
	}

	private normalizeExtensionPaths(
		entries: Array<{ path: string; metadata: PathMetadata; owner?: string }>,
	): Array<{ path: string; metadata: PathMetadata; owner?: string }> {
		return entries.map((entry) => {
			const metadata = entry.metadata.baseDir
				? { ...entry.metadata, baseDir: this.resolveResourcePath(entry.metadata.baseDir) }
				: entry.metadata;
			return {
				path: this.resolveResourcePath(entry.path),
				metadata,
				owner: entry.owner,
			};
		});
	}

	private updateSkillsFromPaths(skillPaths: string[], metadataByPath?: Map<string, PathMetadata>): void {
		let skillsResult: { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
		if (this.noSkills && skillPaths.length === 0) {
			skillsResult = { skills: [], diagnostics: [] };
		} else {
			skillsResult = loadSkills({
				cwd: this.cwd,
				agentDir: this.agentDir,
				skillPaths,
				includeDefaults: false,
			});
		}
		const resolvedSkills = this.skillsOverride ? this.skillsOverride(skillsResult) : skillsResult;
		this.skills = resolvedSkills.skills.map((skill) => ({
			...skill,
			sourceInfo:
				this.findSourceInfoForPath(skill.filePath, this.extensionSkillSourceInfos, metadataByPath) ??
				skill.sourceInfo ??
				this.getDefaultSourceInfoForPath(skill.filePath),
		}));
		this.skillDiagnostics = resolvedSkills.diagnostics;
	}

	private updatePromptsFromPaths(promptPaths: string[], metadataByPath?: Map<string, PathMetadata>): void {
		let promptsResult: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
		if (this.noPromptTemplates && promptPaths.length === 0) {
			promptsResult = { prompts: [], diagnostics: [] };
		} else {
			const allPrompts = loadPromptTemplates({
				cwd: this.cwd,
				agentDir: this.agentDir,
				promptPaths,
				includeDefaults: false,
			});
			promptsResult = this.dedupePrompts(allPrompts);
		}
		const resolvedPrompts = this.promptsOverride ? this.promptsOverride(promptsResult) : promptsResult;
		this.prompts = resolvedPrompts.prompts.map((prompt) => ({
			...prompt,
			sourceInfo:
				this.findSourceInfoForPath(prompt.filePath, this.extensionPromptSourceInfos, metadataByPath) ??
				prompt.sourceInfo ??
				this.getDefaultSourceInfoForPath(prompt.filePath),
		}));
		this.promptDiagnostics = resolvedPrompts.diagnostics;
	}

	private updateThemesFromPaths(themePaths: string[], metadataByPath?: Map<string, PathMetadata>): void {
		let themesResult: { themes: Theme[]; diagnostics: ResourceDiagnostic[] };
		if (this.noThemes && themePaths.length === 0) {
			themesResult = { themes: [], diagnostics: [] };
		} else {
			const loaded = this.loadThemes(themePaths, false);
			const deduped = this.dedupeThemes(loaded.themes);
			themesResult = { themes: deduped.themes, diagnostics: [...loaded.diagnostics, ...deduped.diagnostics] };
		}
		const resolvedThemes = this.themesOverride ? this.themesOverride(themesResult) : themesResult;
		this.themes = resolvedThemes.themes.map((theme) => {
			const sourcePath = theme.sourcePath;
			theme.sourceInfo = sourcePath
				? (this.findSourceInfoForPath(sourcePath, this.extensionThemeSourceInfos, metadataByPath) ??
					theme.sourceInfo ??
					this.getDefaultSourceInfoForPath(sourcePath))
				: theme.sourceInfo;
			return theme;
		});
		this.themeDiagnostics = resolvedThemes.diagnostics;
	}

	private applyExtensionSourceInfo(extensions: Extension[], metadataByPath: Map<string, PathMetadata>): void {
		for (const extension of extensions) {
			extension.sourceInfo =
				this.findSourceInfoForPath(extension.path, undefined, metadataByPath) ??
				this.getDefaultSourceInfoForPath(extension.path);
			for (const command of extension.commands.values()) {
				command.sourceInfo = extension.sourceInfo;
			}
			for (const tool of extension.tools.values()) {
				tool.sourceInfo = extension.sourceInfo;
			}
		}
	}

	private findSourceInfoForPath(
		resourcePath: string,
		extraSourceInfos?: Map<string, SourceInfo>,
		metadataByPath?: Map<string, PathMetadata>,
	): SourceInfo | undefined {
		if (!resourcePath) {
			return undefined;
		}

		if (resourcePath.startsWith("<")) {
			return this.getDefaultSourceInfoForPath(resourcePath);
		}

		const normalizedResourcePath = resolve(resourcePath);
		if (extraSourceInfos) {
			for (const [sourcePath, sourceInfo] of extraSourceInfos.entries()) {
				const normalizedSourcePath = resolve(sourcePath);
				if (
					normalizedResourcePath === normalizedSourcePath ||
					normalizedResourcePath.startsWith(`${normalizedSourcePath}${sep}`)
				) {
					return { ...sourceInfo, path: resourcePath };
				}
			}
		}

		if (metadataByPath) {
			const exact = metadataByPath.get(normalizedResourcePath) ?? metadataByPath.get(resourcePath);
			if (exact) {
				return createSourceInfo(resourcePath, exact);
			}

			for (const [sourcePath, metadata] of metadataByPath.entries()) {
				const normalizedSourcePath = resolve(sourcePath);
				if (
					normalizedResourcePath === normalizedSourcePath ||
					normalizedResourcePath.startsWith(`${normalizedSourcePath}${sep}`)
				) {
					return createSourceInfo(resourcePath, metadata);
				}
			}
		}

		return undefined;
	}

	private getDefaultSourceInfoForPath(filePath: string): SourceInfo {
		if (filePath.startsWith("<") && filePath.endsWith(">")) {
			return {
				path: filePath,
				source: filePath.slice(1, -1).split(":")[0] || "temporary",
				scope: "temporary",
				origin: "top-level",
			};
		}

		const normalizedPath = resolve(filePath);
		const agentRoots = [
			join(this.agentDir, "skills"),
			join(this.agentDir, "prompts"),
			join(this.agentDir, "themes"),
			join(this.agentDir, "extensions"),
		];
		const projectRoots = [
			join(this.cwd, CONFIG_DIR_NAME, "skills"),
			join(this.cwd, CONFIG_DIR_NAME, "prompts"),
			join(this.cwd, CONFIG_DIR_NAME, "themes"),
			join(this.cwd, CONFIG_DIR_NAME, "extensions"),
		];

		for (const root of agentRoots) {
			if (this.isUnderPath(normalizedPath, root)) {
				return { path: filePath, source: "local", scope: "user", origin: "top-level", baseDir: root };
			}
		}

		for (const root of projectRoots) {
			if (this.isUnderPath(normalizedPath, root)) {
				return { path: filePath, source: "local", scope: "project", origin: "top-level", baseDir: root };
			}
		}

		return {
			path: filePath,
			source: "local",
			scope: "temporary",
			origin: "top-level",
			baseDir: statSync(normalizedPath).isDirectory() ? normalizedPath : resolve(normalizedPath, ".."),
		};
	}

	private mergePaths(primary: string[], additional: string[]): string[] {
		const merged: string[] = [];
		const seen = new Set<string>();

		for (const p of [...primary, ...additional]) {
			const resolved = this.resolveResourcePath(p);
			const canonicalPath = canonicalizePath(resolved);
			if (seen.has(canonicalPath)) continue;
			seen.add(canonicalPath);
			merged.push(resolved);
		}

		return merged;
	}

	private mergeDiscoverableResourcePaths(discovered: string[], additional: string[]): string[] {
		return this.additionalResourcePrecedence === "before"
			? this.mergePaths(additional, discovered)
			: this.mergePaths(discovered, additional);
	}

	private resolveResourcePath(p: string): string {
		return resolvePath(p, this.cwd, { trim: true });
	}

	private loadThemes(
		paths: string[],
		includeDefaults: boolean = true,
	): {
		themes: Theme[];
		diagnostics: ResourceDiagnostic[];
	} {
		const themes: Theme[] = [];
		const diagnostics: ResourceDiagnostic[] = [];
		if (includeDefaults) {
			const defaultDirs = [join(this.agentDir, "themes"), join(this.cwd, CONFIG_DIR_NAME, "themes")];

			for (const dir of defaultDirs) {
				this.loadThemesFromDir(dir, themes, diagnostics);
			}
		}

		for (const p of paths) {
			const resolved = this.resolveResourcePath(p);
			if (!existsSync(resolved)) {
				diagnostics.push({ type: "warning", message: "theme path does not exist", path: resolved });
				continue;
			}

			try {
				const stats = statSync(resolved);
				if (stats.isDirectory()) {
					this.loadThemesFromDir(resolved, themes, diagnostics);
				} else if (stats.isFile() && resolved.endsWith(".json")) {
					this.loadThemeFromFile(resolved, themes, diagnostics);
				} else {
					diagnostics.push({ type: "warning", message: "theme path is not a json file", path: resolved });
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : "failed to read theme path";
				diagnostics.push({ type: "warning", message, path: resolved });
			}
		}

		return { themes, diagnostics };
	}

	private loadThemesFromDir(dir: string, themes: Theme[], diagnostics: ResourceDiagnostic[]): void {
		if (!existsSync(dir)) {
			return;
		}

		try {
			const entries = readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				let isFile = entry.isFile();
				if (entry.isSymbolicLink()) {
					try {
						isFile = statSync(join(dir, entry.name)).isFile();
					} catch {
						continue;
					}
				}
				if (!isFile) {
					continue;
				}
				if (!entry.name.endsWith(".json")) {
					continue;
				}
				this.loadThemeFromFile(join(dir, entry.name), themes, diagnostics);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "failed to read theme directory";
			diagnostics.push({ type: "warning", message, path: dir });
		}
	}

	private loadThemeFromFile(filePath: string, themes: Theme[], diagnostics: ResourceDiagnostic[]): void {
		try {
			themes.push(loadThemeFromPath(filePath));
		} catch (error) {
			const message = error instanceof Error ? error.message : "failed to load theme";
			diagnostics.push({ type: "warning", message, path: filePath });
		}
	}

	private async loadExtensionFactories(runtime: ExtensionRuntime): Promise<{
		extensions: Extension[];
		errors: Array<{ path: string; error: string }>;
	}> {
		const extensions: Extension[] = [];
		const errors: Array<{ path: string; error: string }> = [];

		for (const [index, input] of this.extensionFactories.entries()) {
			const isNamed = typeof input !== "function";
			const factory = isNamed ? input.factory : input;
			const extensionPath = `<inline:${isNamed ? input.name : index + 1}>`;
			try {
				const extension = await loadExtensionFromFactory(factory, this.cwd, this.eventBus, runtime, extensionPath);
				extension.hidden = isNamed && input.hidden;
				extensions.push(extension);
			} catch (error) {
				const message = error instanceof Error ? error.message : "failed to load extension";
				errors.push({ path: extensionPath, error: message });
			}
		}

		for (const managedFactory of this.managedExtensionFactories) {
			const extensionPath = `<inline:managed:${managedFactory.name}>`;
			try {
				const extension = await loadExtensionFromFactory(
					managedFactory.factory,
					this.cwd,
					this.eventBus,
					runtime,
					extensionPath,
				);
				const capability = Symbol(`managed-resource:${managedFactory.name}`);
				this.managedResourceCapabilities.set(capability, { precedence: managedFactory.resourcePrecedence });
				extension.hidden = true;
				extension.managedResource = { capability, precedence: managedFactory.resourcePrecedence };
				extensions.push(extension);
			} catch (error) {
				const message = error instanceof Error ? error.message : "failed to load extension";
				errors.push({ path: extensionPath, error: message });
			}
		}

		return { extensions, errors };
	}

	private dedupePrompts(prompts: PromptTemplate[]): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] } {
		const seen = new Map<string, PromptTemplate>();
		const diagnostics: ResourceDiagnostic[] = [];

		for (const prompt of prompts) {
			const existing = seen.get(prompt.name);
			if (existing) {
				diagnostics.push({
					type: "collision",
					message: `name "/${prompt.name}" collision`,
					path: prompt.filePath,
					collision: {
						resourceType: "prompt",
						name: prompt.name,
						winnerPath: existing.filePath,
						loserPath: prompt.filePath,
					},
				});
			} else {
				seen.set(prompt.name, prompt);
			}
		}

		return { prompts: Array.from(seen.values()), diagnostics };
	}

	private dedupeThemes(themes: Theme[]): { themes: Theme[]; diagnostics: ResourceDiagnostic[] } {
		const seen = new Map<string, Theme>();
		const diagnostics: ResourceDiagnostic[] = [];

		for (const t of themes) {
			const name = t.name ?? "unnamed";
			const existing = seen.get(name);
			if (existing) {
				diagnostics.push({
					type: "collision",
					message: `name "${name}" collision`,
					path: t.sourcePath,
					collision: {
						resourceType: "theme",
						name,
						winnerPath: existing.sourcePath ?? "<builtin>",
						loserPath: t.sourcePath ?? "<builtin>",
					},
				});
			} else {
				seen.set(name, t);
			}
		}

		return { themes: Array.from(seen.values()), diagnostics };
	}

	private discoverSystemPromptFile(): string | undefined {
		const projectPath = join(this.cwd, CONFIG_DIR_NAME, "SYSTEM.md");
		if (this.settingsManager.isProjectTrusted() && existsSync(projectPath)) {
			return projectPath;
		}

		const globalPath = join(this.agentDir, "SYSTEM.md");
		if (existsSync(globalPath)) {
			return globalPath;
		}

		return undefined;
	}

	private discoverAppendSystemPromptFile(): string | undefined {
		const projectPath = join(this.cwd, CONFIG_DIR_NAME, "APPEND_SYSTEM.md");
		if (this.settingsManager.isProjectTrusted() && existsSync(projectPath)) {
			return projectPath;
		}

		const globalPath = join(this.agentDir, "APPEND_SYSTEM.md");
		if (existsSync(globalPath)) {
			return globalPath;
		}

		return undefined;
	}

	private isUnderPath(target: string, root: string): boolean {
		const normalizedRoot = resolve(root);
		if (target === normalizedRoot) {
			return true;
		}
		const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
		return target.startsWith(prefix);
	}

	private detectExtensionConflicts(extensions: Extension[]): Array<{ path: string; message: string }> {
		const conflicts: Array<{ path: string; message: string }> = [];

		// Track which extension registered each tool and flag
		const toolOwners = new Map<string, string>();
		const flagOwners = new Map<string, string>();

		for (const ext of extensions) {
			// Check tools
			for (const toolName of ext.tools.keys()) {
				const existingOwner = toolOwners.get(toolName);
				if (existingOwner && existingOwner !== ext.path) {
					conflicts.push({
						path: ext.path,
						message: `Tool "${toolName}" conflicts with ${existingOwner}`,
					});
				} else {
					toolOwners.set(toolName, ext.path);
				}
			}

			// Check flags
			for (const flagName of ext.flags.keys()) {
				const existingOwner = flagOwners.get(flagName);
				if (existingOwner && existingOwner !== ext.path) {
					conflicts.push({
						path: ext.path,
						message: `Flag "--${flagName}" conflicts with ${existingOwner}`,
					});
				} else {
					flagOwners.set(flagName, ext.path);
				}
			}
		}

		return conflicts;
	}
}
