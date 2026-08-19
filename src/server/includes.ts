/**
 * Tracks which root documents pull in which `.include`d files.
 *
 * A file can be included by several roots at once, so an included file may only
 * be dropped from the index once no root refers to it any more - otherwise
 * closing one document silently removes symbols another still depends on.
 */
export class IncludeGraph {
    /** included file URI -> set of root document URIs that reach it */
    private refs: Map<string, Set<string>> = new Map();

    /** Record that `rootUri` (transitively) includes `includeUri`. */
    addRef(includeUri: string, rootUri: string): void {
        let roots = this.refs.get(includeUri);
        if (!roots) {
            roots = new Set();
            this.refs.set(includeUri, roots);
        }
        roots.add(rootUri);
    }

    /**
     * Drop `rootUri` as a referrer of everything it used to include.
     * @returns the include URIs that no root refers to any more, i.e. those safe
     *          to remove from the document index.
     */
    clearRoot(rootUri: string): string[] {
        const orphaned: string[] = [];
        for (const [includeUri, roots] of this.refs) {
            roots.delete(rootUri);
            if (roots.size === 0) {
                orphaned.push(includeUri);
                this.refs.delete(includeUri);
            }
        }
        return orphaned;
    }

    /** Whether any root still includes this file. */
    isReferenced(uri: string): boolean {
        const roots = this.refs.get(uri);
        return roots !== undefined && roots.size > 0;
    }

    /** Root documents that reach this file, for revalidating a whole include tree. */
    rootsFor(uri: string): string[] {
        return [...(this.refs.get(uri) ?? [])];
    }

    /**
     * Every root whose include tree `uri` participates in, including `uri` itself.
     * Used to decide which documents need their diagnostics refreshed after an edit.
     */
    affectedRoots(uri: string): string[] {
        return [...new Set([uri, ...this.rootsFor(uri)])];
    }

    /**
     * Every document assembled together with `uri` - its own include tree, and
     * the trees of any roots that pull it in, so files included side by side
     * under one root can see each other (verified: a sibling's symbols resolve
     * across an `.include`, since the assembler splices them into one source).
     *
     * A file no root includes is a unit of one: symbols from an unrelated file
     * elsewhere in the workspace are not in scope, and offering them is wrong.
     */
    compilationUnit(uri: string): Set<string> {
        const roots = new Set(this.affectedRoots(uri));
        const unit = new Set(roots);
        for (const [includeUri, includeRoots] of this.refs) {
            for (const root of includeRoots) {
                if (roots.has(root)) {
                    unit.add(includeUri);
                    break;
                }
            }
        }
        return unit;
    }
}
