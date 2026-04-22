import { closeSync, existsSync, openSync, readSync } from "node:fs";

export const PUBLISHED_BUILD_PLATFORM = "linux";
export const PUBLISHED_BUILD_ARCH = "x64";

const HEADER_SIZE = 4096;
const MAX_FAT_ARCH_COUNT = 30;

function mapElfMachine(machine: number): string | null {
	switch (machine) {
		case 62:
			return "x64";
		case 183:
			return "arm64";
		default:
			return null;
	}
}

function mapMachCpuType(cpuType: number): string | null {
	switch (cpuType) {
		case 0x01000007:
			return "x64";
		case 0x0100000c:
			return "arm64";
		default:
			return null;
	}
}

function mapPeMachine(machine: number): string | null {
	switch (machine) {
		case 0x8664:
			return "x64";
		case 0xaa64:
			return "arm64";
		default:
			return null;
	}
}

function readUInt16(buffer: Buffer, offset: number, littleEndian: boolean): number {
	return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
}

function readUInt32(buffer: Buffer, offset: number, littleEndian: boolean): number {
	return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

const ELF_MAGIC = 0x7f454c46;

function detectElfTarget(buffer: Buffer): { platform: string; architectures: string[] } | null {
	if (buffer.length < 20) return null;
	if (buffer.readUInt32BE(0) !== ELF_MAGIC) return null;

	const littleEndian = buffer[5] !== 2;
	const arch = mapElfMachine(readUInt16(buffer, 18, littleEndian));
	if (!arch) return null;

	return { platform: "linux", architectures: [arch] };
}

const THIN_MACH_MAGIC = new Map<number, boolean>([
	[0xfeedface, false],
	[0xfeedfacf, false],
	[0xcefaedfe, true],
	[0xcffaedfe, true],
]);
const FAT_MACH_MAGIC = new Map<number, boolean>([
	[0xcafebabe, false],
	[0xcafebabf, false],
	[0xbebafeca, true],
	[0xbfbafeca, true],
]);

function detectMachTarget(buffer: Buffer): { platform: string; architectures: string[] } | null {
	if (buffer.length < 8) return null;

	const magic = buffer.readUInt32BE(0);

	if (THIN_MACH_MAGIC.has(magic)) {
		const littleEndian = THIN_MACH_MAGIC.get(magic) ?? false;
		const arch = mapMachCpuType(readUInt32(buffer, 4, littleEndian));
		if (!arch) return null;
		return { platform: "darwin", architectures: [arch] };
	}

	if (!FAT_MACH_MAGIC.has(magic)) return null;

	const littleEndian = FAT_MACH_MAGIC.get(magic) ?? false;
	const archCount = readUInt32(buffer, 4, littleEndian);
	if (archCount <= 0 || archCount > MAX_FAT_ARCH_COUNT) return null;

	const architectures = new Set<string>();
	let cursor = 8;
	for (let i = 0; i < archCount; i++) {
		if (cursor + 20 > buffer.length) break;
		const arch = mapMachCpuType(readUInt32(buffer, cursor, littleEndian));
		if (arch) architectures.add(arch);
		cursor += 20;
	}

	if (architectures.size === 0) return null;
	return { platform: "darwin", architectures: Array.from(architectures) };
}

const PE_MAGIC = 0x5a4d;

function detectPeTarget(buffer: Buffer): { platform: string; architectures: string[] } | null {
	if (buffer.length < 0x86) return null;
	if (buffer.readUInt16LE(0) !== PE_MAGIC) return null;

	const peOffset = buffer.readUInt32LE(0x3c);
	if (peOffset + 6 > buffer.length) return null;
	if (buffer.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") return null;

	const arch = mapPeMachine(buffer.readUInt16LE(peOffset + 4));
	if (!arch) return null;

	return { platform: "win32", architectures: [arch] };
}

export function detectNativeBinaryTarget(buffer: Buffer) {
	const detectors = [detectElfTarget, detectMachTarget, detectPeTarget];
	for (const detectTarget of detectors) {
		const detectedTarget = detectTarget(buffer);
		if (detectedTarget) {
			return detectedTarget;
		}
	}
	return null;
}

export function isNativeBinaryCompatible(
	binaryPath: string,
	target: {
		platform?: string;
		arch?: string;
		runtimePlatform?: string;
		runtimeArch?: string;
		dlopen?: (path: string) => void;
	} = {}
): boolean {
	if (!existsSync(binaryPath)) return false;

	const fd = openSync(binaryPath, "r");
	try {
		const buffer = Buffer.alloc(HEADER_SIZE);
		const bytesRead = readSync(fd, buffer, 0, HEADER_SIZE, 0);
		const slice = buffer.subarray(0, bytesRead);
		const detected = detectNativeBinaryTarget(slice);
		if (!detected) return false;

		const platform = target.runtimePlatform || target.platform || process.platform;
		const arch = target.runtimeArch || target.arch || process.arch;
		if (detected.platform !== platform || !detected.architectures.includes(arch)) {
			return false;
		}

		if (typeof target.dlopen === "function") {
			try {
				target.dlopen(binaryPath);
			} catch {
				return false;
			}
		}

		return true;
	} finally {
		closeSync(fd);
	}
}
