#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_SCHEMA_PATH = "packages/contracts/schema/fact-metadata.schema.json";
const DEFAULT_TS_PATH = "packages/contracts/src/factMetadataValues.generated.ts";
const DEFAULT_SWIFT_PATH = "apps/ios/AnnualRingsGateA/Sources/AnnualRingsGateA/FactMetadataValues.generated.swift";
const SUPPORTED_PROPERTY_KEYWORDS = new Set(["enum", "format", "minLength", "pattern", "type"]);

export async function generateContractSchemaBindings({
  checkOnly = false,
  schemaPath = DEFAULT_SCHEMA_PATH,
  tsPath = DEFAULT_TS_PATH,
  swiftPath = DEFAULT_SWIFT_PATH
} = {}) {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const contract = contractMetadata(schema);
  const outputs = {
    [tsPath]: renderTypeScript(contract),
    [swiftPath]: renderSwift(contract)
  };
  const drift = [];
  for (const [path, expected] of Object.entries(outputs)) {
    if (checkOnly) {
      const actual = await readFile(path, "utf8").catch(() => "");
      if (actual !== expected) drift.push(path);
    } else {
      await writeFile(path, expected);
    }
  }
  return {
    ok: drift.length === 0,
    mode: checkOnly ? "check" : "write",
    schemaPath,
    outputs: Object.keys(outputs),
    drift,
    contract: {
      keys: contract.keys,
      requiredKeys: contract.requiredKeys,
      nullableKeys: contract.nullableKeys,
      dateTimeKeys: contract.dateTimeKeys,
      additionalProperties: contract.additionalProperties
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await generateContractSchemaBindings({ checkOnly: process.argv.includes("--check") });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

export function contractMetadata(schemaValue) {
  if (schemaValue?.type !== "object" || !isRecord(schemaValue.properties)) {
    throw new Error("fact metadata schema must define object properties");
  }
  if (schemaValue.additionalProperties !== false) {
    throw new Error("fact metadata schema must reject additional properties");
  }
  const keys = Object.keys(schemaValue.properties);
  if (keys.length === 0 || keys.some((key) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))) {
    throw new Error("fact metadata properties must use supported non-empty identifiers");
  }
  const requiredKeys = requireUniquePropertyNames(schemaValue.required, keys, "required");
  const nonRequiredKeys = keys.filter((key) => !requiredKeys.includes(key));
  if (nonRequiredKeys.length > 0) {
    throw new Error(`fact metadata properties must all be required; missing: ${nonRequiredKeys.join(", ")}`);
  }

  const properties = Object.fromEntries(keys.map((key) => {
    const property = schemaValue.properties[key];
    if (!isRecord(property)) throw new Error(`${key} must define a property schema`);
    const unsupportedKeywords = Object.keys(property).filter((keyword) => !SUPPORTED_PROPERTY_KEYWORDS.has(keyword));
    if (unsupportedKeywords.length > 0) {
      throw new Error(`${key} uses unsupported schema keyword(s): ${unsupportedKeywords.sort().join(", ")}`);
    }
    const enumValues = property.enum === undefined ? null : stringEnum(property.enum, key);
    const declaredTypes = Array.isArray(property.type)
      ? property.type
      : property.type === undefined && enumValues !== null
        ? ["string"]
        : [property.type];
    if (declaredTypes.some((type) => type !== "string" && type !== "boolean" && type !== "null")) {
      throw new Error(`${key} uses an unsupported schema type`);
    }
    const nullable = declaredTypes.includes("null");
    const valueTypes = declaredTypes.filter((type) => type !== "null");
    if (valueTypes.length !== 1) throw new Error(`${key} must define exactly one non-null type`);
    const kind = valueTypes[0];
    if (enumValues !== null && kind !== "string") throw new Error(`${key} enum must be string-valued`);
    if (property.format !== undefined && property.format !== "date-time") {
      throw new Error(`${key} uses an unsupported format`);
    }
    if (property.format === "date-time" && kind !== "string") {
      throw new Error(`${key} date-time format must apply to a string`);
    }
    const minLength = property.minLength ?? null;
    if (minLength !== null && (!Number.isInteger(minLength) || minLength < 0 || kind !== "string")) {
      throw new Error(`${key} minLength must be a non-negative integer on a string`);
    }
    const pattern = property.pattern ?? null;
    if (pattern !== null && (typeof pattern !== "string" || kind !== "string")) {
      throw new Error(`${key} pattern must be a string constraint`);
    }
    if (pattern !== null) new RegExp(pattern, "u");
    return [key, {
      required: requiredKeys.includes(key),
      nullable,
      kind,
      format: property.format ?? null,
      minLength,
      pattern,
      enumValues
    }];
  }));

  return {
    keys,
    requiredKeys,
    nullableKeys: keys.filter((key) => properties[key].nullable),
    dateTimeKeys: keys.filter((key) => properties[key].format === "date-time"),
    booleanKeys: keys.filter((key) => properties[key].kind === "boolean"),
    nonEmptyStringKeys: keys.filter((key) => properties[key].kind === "string" && properties[key].minLength > 0),
    additionalProperties: schemaValue.additionalProperties,
    properties,
    freshness: enumValues(properties, "freshness"),
    provenance: enumValues(properties, "provenance"),
    authority: enumValues(properties, "authority")
  };
}

function requireUniquePropertyNames(value, keys, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((key) => typeof key !== "string" || !keys.includes(key))) {
    throw new Error(`${label} must list schema property names`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} must not contain duplicates`);
  return value;
}

function stringEnum(value, property) {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${property} must define a non-empty string enum`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${property} enum must not contain duplicates`);
  return value;
}

function enumValues(properties, property) {
  const values = properties[property]?.enumValues;
  if (values === null || values === undefined) throw new Error(`${property} must define an enum`);
  return values;
}

function quoted(values) {
  return values.map((value) => JSON.stringify(value)).join(", ");
}

function renderTypeScript(contractValue) {
  const propertyLines = contractValue.keys.map((key) => {
    const property = contractValue.properties[key];
    return `  ${JSON.stringify(key)}: ${JSON.stringify(property)}`;
  });
  return [
    "// Generated by scripts/generate-contract-schema-bindings.mjs. Do not edit.",
    `export const FACT_METADATA_KEYS = [${quoted(contractValue.keys)}] as const;`,
    `export const FACT_METADATA_REQUIRED_KEYS = [${quoted(contractValue.requiredKeys)}] as const;`,
    `export const FACT_METADATA_NULLABLE_KEYS = [${quoted(contractValue.nullableKeys)}] as const;`,
    `export const FACT_METADATA_DATE_TIME_KEYS = [${quoted(contractValue.dateTimeKeys)}] as const;`,
    `export const FACT_METADATA_BOOLEAN_KEYS = [${quoted(contractValue.booleanKeys)}] as const;`,
    `export const FACT_METADATA_NON_EMPTY_STRING_KEYS = [${quoted(contractValue.nonEmptyStringKeys)}] as const;`,
    `export const FACT_METADATA_ALLOWS_ADDITIONAL_PROPERTIES = ${contractValue.additionalProperties};`,
    "export const FACT_METADATA_PROPERTY_METADATA = {",
    propertyLines.join(",\n"),
    "} as const;",
    `export const FACT_FRESHNESS_VALUES = [${quoted(contractValue.freshness)}] as const;`,
    `export const FACT_PROVENANCE_VALUES = [${quoted(contractValue.provenance)}] as const;`,
    `export const FACT_AUTHORITY_VALUES = [${quoted(contractValue.authority)}] as const;`,
    ""
  ].join("\n");
}

function renderSwift(contractValue) {
  const decodeLines = contractValue.keys.map((key) => {
    const property = contractValue.properties[key];
    const type = property.kind === "boolean" ? "Bool" : "String";
    return property.nullable
      ? `        self.${key} = try decodeFactMetadataRequiredNullable(${type}.self, from: container, key: ${JSON.stringify(key)})`
      : `        self.${key} = try container.decode(${type}.self, forKey: factMetadataKey(${JSON.stringify(key)}))`;
  });
  const encodeLines = contractValue.keys.map((key) => {
    const property = contractValue.properties[key];
    return property.nullable
      ? `        try encodeFactMetadataRequiredNullable(${key}, into: &container, key: ${JSON.stringify(key)})`
      : `        try container.encode(${key}, forKey: factMetadataKey(${JSON.stringify(key)}))`;
  });
  return [
    "// Generated by scripts/generate-contract-schema-bindings.mjs. Do not edit.",
    "enum FactMetadataValues {",
    `    static let keys = [${quoted(contractValue.keys)}]`,
    `    static let requiredKeys = [${quoted(contractValue.requiredKeys)}]`,
    `    static let nullableKeys = [${quoted(contractValue.nullableKeys)}]`,
    `    static let dateTimeKeys = [${quoted(contractValue.dateTimeKeys)}]`,
    `    static let booleanKeys = [${quoted(contractValue.booleanKeys)}]`,
    `    static let nonEmptyStringKeys = [${quoted(contractValue.nonEmptyStringKeys)}]`,
    `    static let allowsAdditionalProperties = ${contractValue.additionalProperties}`,
    `    static let freshness = [${quoted(contractValue.freshness)}]`,
    `    static let provenance = [${quoted(contractValue.provenance)}]`,
    `    static let authority = [${quoted(contractValue.authority)}]`,
    "}",
    "",
    "private struct FactMetadataCodingKey: CodingKey {",
    "    let stringValue: String",
    "    let intValue: Int? = nil",
    "    init?(stringValue: String) { self.stringValue = stringValue }",
    "    init?(intValue: Int) { return nil }",
    "}",
    "",
    "extension FactMetadata: Codable {",
    "    public init(from decoder: Decoder) throws {",
    "        let container = try decoder.container(keyedBy: FactMetadataCodingKey.self)",
    "        let presentKeys = Set(container.allKeys.map(\\.stringValue))",
    "        if let missing = FactMetadataValues.requiredKeys.first(where: { presentKeys.contains($0) == false }) {",
    "            throw DecodingError.keyNotFound(factMetadataKey(missing), .init(codingPath: decoder.codingPath, debugDescription: \"Every required key must be present; nullable values must use explicit null.\"))",
    "        }",
    "        if FactMetadataValues.allowsAdditionalProperties == false,",
    "           let unknown = presentKeys.first(where: { FactMetadataValues.keys.contains($0) == false }) {",
    "            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath + [factMetadataKey(unknown)], debugDescription: \"Additional fact metadata properties are not allowed.\"))",
    "        }",
    ...decodeLines,
    "    }",
    "",
    "    public func encode(to encoder: Encoder) throws {",
    "        var container = encoder.container(keyedBy: FactMetadataCodingKey.self)",
    ...encodeLines,
    "    }",
    "}",
    "",
    "private func factMetadataKey(_ value: String) -> FactMetadataCodingKey {",
    "    FactMetadataCodingKey(stringValue: value)!",
    "}",
    "",
    "private func decodeFactMetadataRequiredNullable<T: Decodable>(",
    "    _ type: T.Type,",
    "    from container: KeyedDecodingContainer<FactMetadataCodingKey>,",
    "    key: String",
    ") throws -> T? {",
    "    let codingKey = factMetadataKey(key)",
    "    return try container.decodeNil(forKey: codingKey) ? nil : container.decode(type, forKey: codingKey)",
    "}",
    "",
    "private func encodeFactMetadataRequiredNullable<T: Encodable>(",
    "    _ value: T?,",
    "    into container: inout KeyedEncodingContainer<FactMetadataCodingKey>,",
    "    key: String",
    ") throws {",
    "    let codingKey = factMetadataKey(key)",
    "    if let value { try container.encode(value, forKey: codingKey) } else { try container.encodeNil(forKey: codingKey) }",
    "}",
    "",
    "func factMetadataIsRFC3339DateTime(_ value: String) -> Bool {",
    "    let bytes = Array(value.utf8)",
    "    guard bytes.count >= 20, bytes[4] == 45, bytes[7] == 45, (bytes[10] == 84 || bytes[10] == 116),",
    "          bytes[13] == 58, bytes[16] == 58,",
    "          let year = factMetadataDecimal(bytes, 0, 4), let month = factMetadataDecimal(bytes, 5, 2),",
    "          let day = factMetadataDecimal(bytes, 8, 2), let hour = factMetadataDecimal(bytes, 11, 2),",
    "          let minute = factMetadataDecimal(bytes, 14, 2), let second = factMetadataDecimal(bytes, 17, 2),",
    "          (1...12).contains(month), hour <= 23, minute <= 59, second <= 60 else { return false }",
    "    let monthDays = [31, factMetadataLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]",
    "    guard day >= 1, day <= monthDays[month - 1] else { return false }",
    "    var index = 19",
    "    if index < bytes.count, bytes[index] == 46 {",
    "        index += 1",
    "        let fractionStart = index",
    "        while index < bytes.count, (48...57).contains(bytes[index]) { index += 1 }",
    "        if index == fractionStart { return false }",
    "    }",
    "    guard index < bytes.count else { return false }",
    "    if bytes[index] == 90 || bytes[index] == 122 { return index + 1 == bytes.count }",
    "    guard (bytes[index] == 43 || bytes[index] == 45), index + 6 == bytes.count, bytes[index + 3] == 58,",
    "          let offsetHour = factMetadataDecimal(bytes, index + 1, 2),",
    "          let offsetMinute = factMetadataDecimal(bytes, index + 4, 2) else { return false }",
    "    return offsetHour <= 23 && offsetMinute <= 59",
    "}",
    "",
    "private func factMetadataDecimal(_ bytes: [UInt8], _ start: Int, _ length: Int) -> Int? {",
    "    guard start >= 0, length > 0, start + length <= bytes.count else { return nil }",
    "    var value = 0",
    "    for byte in bytes[start..<(start + length)] {",
    "        guard (48...57).contains(byte) else { return nil }",
    "        value = value * 10 + Int(byte - 48)",
    "    }",
    "    return value",
    "}",
    "",
    "private func factMetadataLeapYear(_ year: Int) -> Bool {",
    "    year.isMultiple(of: 4) && (year.isMultiple(of: 100) == false || year.isMultiple(of: 400))",
    "}",
    ""
  ].join("\n");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
