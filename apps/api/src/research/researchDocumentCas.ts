import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { ResearchDocumentError } from "./domain.js";

export async function storeResearchDocumentBytes(
  rawStoreRoot: string | null | undefined,
  repositoryRoot: string,
  pdfSha256: string,
  bytes: Buffer
): Promise<void> {
  const root = await validatedRawStoreRoot(rawStoreRoot, repositoryRoot);
  const directory = await requireCasPrefix(root, pdfSha256, true);
  const target = join(directory, pdfSha256);
  const temporary = join(directory, `.${pdfSha256}.${randomUUID()}.tmp`);
  const handle = await open(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await assertCasPrefix(root, directory);
    await link(temporary, target);
    await readAndVerify(root, pdfSha256, bytes.length);
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error;
    const existing = await readAndVerify(root, pdfSha256, bytes.length);
    if (!existing.equals(bytes)) {
      throw new ResearchDocumentError(409, "RAW_CONTENT_HASH_CONFLICT", "existing content-addressed PDF bytes do not match their hash");
    }
  } finally {
    await assertCasPrefix(root, directory)
      .then(() => unlink(temporary))
      .catch(() => undefined);
  }
}

export async function readResearchDocumentBytes(
  rawStoreRoot: string | null | undefined,
  repositoryRoot: string,
  pdfSha256: string,
  byteLength: number
): Promise<Buffer> {
  const root = await validatedRawStoreRoot(rawStoreRoot, repositoryRoot);
  return readAndVerify(root, pdfSha256, byteLength);
}

// The CAS layout and byte/hash checks are media-neutral. Preserve the PDF
// entry points and reuse the identical immutable storage for HTML originals.
export const storeResearchRawBytes = storeResearchDocumentBytes;
export const readResearchRawBytes = readResearchDocumentBytes;

export async function validatedRawStoreRoot(
  rawStoreRoot: string | null | undefined,
  repositoryRoot: string
): Promise<string> {
  if (!rawStoreRoot) {
    throw new ResearchDocumentError(503, "RAW_STORE_UNAVAILABLE", "research document raw store is not configured");
  }
  if (!isAbsolute(rawStoreRoot) || rawStoreRoot.includes("\0")) {
    throw new ResearchDocumentError(503, "RAW_STORE_INVALID", "research document raw store must be an absolute path outside the repository");
  }
  const lexicalRepository = resolve(repositoryRoot);
  const lexicalRoot = resolve(rawStoreRoot);
  if (isWithin(lexicalRepository, lexicalRoot)) {
    throw new ResearchDocumentError(503, "RAW_STORE_INVALID", "research document raw store must be outside the repository");
  }
  const repository = await realpath(lexicalRepository);
  await mkdir(lexicalRoot, { recursive: true });
  const root = await realpath(lexicalRoot);
  if (isWithin(repository, root)) {
    throw new ResearchDocumentError(503, "RAW_STORE_INVALID", "research document raw store must be outside the repository");
  }
  return root;
}

function isWithin(parent: string, candidate: string): boolean {
  const fromParent = relative(parent, candidate);
  return fromParent === "" || (!fromParent.startsWith("..") && !isAbsolute(fromParent));
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function requireCasPrefix(root: string, sha256: string, create: boolean): Promise<string> {
  const lexicalDirectory = join(root, sha256.slice(0, 2));
  if (create) {
    await mkdir(lexicalDirectory).catch((error) => {
      if (!isNodeError(error, "EEXIST")) throw error;
    });
  }
  let stat;
  try {
    stat = await lstat(lexicalDirectory);
  } catch {
    throw new ResearchDocumentError(503, "RAW_CONTENT_MISSING", "content-addressed PDF bytes are unavailable");
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new ResearchDocumentError(503, "RAW_STORE_INVALID", "content-addressed PDF prefix must be a real directory");
  }
  const directory = await realpath(lexicalDirectory);
  if (!isWithin(root, directory)) {
    throw new ResearchDocumentError(503, "RAW_STORE_INVALID", "content-addressed PDF prefix escapes the configured raw store");
  }
  return directory;
}

async function assertCasPrefix(root: string, expectedDirectory: string): Promise<void> {
  const stat = await lstat(expectedDirectory);
  if (stat.isSymbolicLink() || !stat.isDirectory() || !isWithin(root, await realpath(expectedDirectory))) {
    throw new ResearchDocumentError(503, "RAW_STORE_INVALID", "content-addressed PDF prefix is no longer contained in the raw store");
  }
}

async function readAndVerify(root: string, expectedSha256: string, expectedByteLength: number): Promise<Buffer> {
  const directory = await requireCasPrefix(root, expectedSha256, false);
  const path = join(directory, expectedSha256);
  let stat;
  try {
    stat = await lstat(path);
  } catch {
    throw new ResearchDocumentError(503, "RAW_CONTENT_MISSING", "content-addressed PDF bytes are unavailable");
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new ResearchDocumentError(503, "RAW_STORE_INVALID", "content-addressed PDF object must be a regular file");
  }
  const objectPath = await realpath(path);
  if (!isWithin(root, objectPath)) {
    throw new ResearchDocumentError(503, "RAW_STORE_INVALID", "content-addressed PDF object escapes the configured raw store");
  }
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new ResearchDocumentError(503, "RAW_CONTENT_MISSING", "content-addressed PDF bytes are unavailable");
  }
  let bytes: Buffer;
  try {
    if (!(await handle.stat()).isFile()) {
      throw new ResearchDocumentError(503, "RAW_STORE_INVALID", "content-addressed PDF object must be a regular file");
    }
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  await assertCasPrefix(root, directory);
  const finalStat = await lstat(path);
  if (finalStat.isSymbolicLink() || !finalStat.isFile() || !isWithin(root, await realpath(path))) {
    throw new ResearchDocumentError(503, "RAW_STORE_INVALID", "content-addressed PDF object is no longer contained in the raw store");
  }
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== expectedByteLength || actualSha256 !== expectedSha256) {
    throw new ResearchDocumentError(503, "RAW_CONTENT_HASH_MISMATCH", "content-addressed PDF bytes failed hash verification");
  }
  return bytes;
}
