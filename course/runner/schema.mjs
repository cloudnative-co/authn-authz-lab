import { readFile } from 'node:fs/promises';
import { canonicalJson } from './canonical.mjs';

const SUPPORTED_KEYWORDS = new Set([
  '$schema', '$id', '$ref', '$defs', '$comment', 'title', 'description',
  'type', 'required', 'properties', 'additionalProperties',
  'enum', 'const', 'pattern', 'format', 'minLength', 'maxLength',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'items', 'minItems', 'maxItems', 'uniqueItems',
  'anyOf', 'oneOf', 'allOf', 'not',
]);
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

export class SchemaDefinitionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchemaDefinitionError';
  }
}

export class SchemaValidationError extends Error {
  constructor(errors, label = 'value') {
    super(`${label} does not satisfy its schema:\n${errors.map((error) => `- ${error.path}: ${error.message}`).join('\n')}`);
    this.name = 'SchemaValidationError';
    this.errors = errors;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function inspectSchema(schema, path, seen) {
  if (typeof schema === 'boolean') return;
  if (!isPlainObject(schema)) throw new SchemaDefinitionError(`${path}: schema must be an object or boolean`);
  if (seen.has(schema)) return;
  seen.add(schema);

  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(key)) throw new SchemaDefinitionError(`${path}: unsupported schema keyword ${key}`);
  }
  if (schema.$schema !== undefined && schema.$schema !== DRAFT_2020_12) {
    throw new SchemaDefinitionError(`${path}.$schema: only JSON Schema Draft 2020-12 is supported`);
  }
  for (const keyword of ['$schema', '$id', '$ref', '$comment', 'title', 'description', 'format']) {
    if (schema[keyword] !== undefined && typeof schema[keyword] !== 'string') {
      throw new SchemaDefinitionError(`${path}.${keyword}: must be a string`);
    }
  }
  if (schema.type !== undefined) {
    const values = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (values.length === 0 || new Set(values).size !== values.length || values.some((value) => !TYPES.has(value))) {
      throw new SchemaDefinitionError(`${path}.type: unsupported JSON type`);
    }
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== 'string'))) {
    throw new SchemaDefinitionError(`${path}.required: must be an array of strings`);
  }
  if (schema.required !== undefined && new Set(schema.required).size !== schema.required.length) {
    throw new SchemaDefinitionError(`${path}.required: entries must be unique`);
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    throw new SchemaDefinitionError(`${path}.enum: must be a non-empty array`);
  }
  for (const keyword of ['minLength', 'maxLength', 'minItems', 'maxItems']) {
    if (schema[keyword] !== undefined && (!Number.isInteger(schema[keyword]) || schema[keyword] < 0)) {
      throw new SchemaDefinitionError(`${path}.${keyword}: must be a non-negative integer`);
    }
  }
  for (const keyword of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']) {
    if (schema[keyword] !== undefined && (typeof schema[keyword] !== 'number' || !Number.isFinite(schema[keyword]))) {
      throw new SchemaDefinitionError(`${path}.${keyword}: must be a finite number`);
    }
  }
  if (schema.uniqueItems !== undefined && typeof schema.uniqueItems !== 'boolean') {
    throw new SchemaDefinitionError(`${path}.uniqueItems: must be a boolean`);
  }
  if (schema.minLength !== undefined && schema.maxLength !== undefined && schema.minLength > schema.maxLength) {
    throw new SchemaDefinitionError(`${path}: minLength exceeds maxLength`);
  }
  if (schema.minItems !== undefined && schema.maxItems !== undefined && schema.minItems > schema.maxItems) {
    throw new SchemaDefinitionError(`${path}: minItems exceeds maxItems`);
  }
  if (schema.properties !== undefined) {
    if (!isPlainObject(schema.properties)) throw new SchemaDefinitionError(`${path}.properties: must be an object`);
    for (const [key, child] of Object.entries(schema.properties)) inspectSchema(child, `${path}.properties.${key}`, seen);
  }
  if (schema.$defs !== undefined) {
    if (!isPlainObject(schema.$defs)) throw new SchemaDefinitionError(`${path}.$defs: must be an object`);
    for (const [key, child] of Object.entries(schema.$defs)) inspectSchema(child, `${path}.$defs.${key}`, seen);
  }
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
    inspectSchema(schema.additionalProperties, `${path}.additionalProperties`, seen);
  }
  if (schema.items !== undefined) inspectSchema(schema.items, `${path}.items`, seen);
  for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
    if (schema[keyword] === undefined) continue;
    if (!Array.isArray(schema[keyword]) || schema[keyword].length === 0) {
      throw new SchemaDefinitionError(`${path}.${keyword}: must be a non-empty array`);
    }
    schema[keyword].forEach((child, index) => inspectSchema(child, `${path}.${keyword}[${index}]`, seen));
  }
  if (schema.not !== undefined) inspectSchema(schema.not, `${path}.not`, seen);
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== 'string') throw new SchemaDefinitionError(`${path}.pattern: must be a string`);
    try {
      new RegExp(schema.pattern, 'u');
    } catch (error) {
      throw new SchemaDefinitionError(`${path}.pattern: invalid regular expression: ${error.message}`);
    }
  }
  if (schema.format !== undefined && schema.format !== 'date-time') {
    throw new SchemaDefinitionError(`${path}.format: unsupported format ${schema.format}`);
  }
  if (schema.$ref !== undefined && (typeof schema.$ref !== 'string' || !schema.$ref.startsWith('#/'))) {
    throw new SchemaDefinitionError(`${path}.$ref: only local JSON pointers are supported`);
  }
}

function resolveReference(rootSchema, reference) {
  let node = rootSchema;
  for (const encodedSegment of reference.slice(2).split('/')) {
    const segment = encodedSegment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!isPlainObject(node) || !Object.hasOwn(node, segment)) {
      throw new SchemaDefinitionError(`unresolved schema reference: ${reference}`);
    }
    node = node[segment];
  }
  return node;
}

function matchesType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isPlainObject(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function equalJson(left, right) {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function addError(errors, path, message) {
  errors.push({ path, message });
}

function validateDateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , offsetHour = '00', offsetMinute = '00'] = match;
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const daysInMonth = new Date(Date.UTC(numericYear, numericMonth, 0)).getUTCDate();
  if (numericMonth < 1 || numericMonth > 12 || Number(day) < 1 || Number(day) > daysInMonth) return false;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
  if (Number(offsetHour) > 23 || Number(offsetMinute) > 59) return false;
  return !Number.isNaN(Date.parse(value));
}

function validateNode(value, schema, rootSchema, path, errors, referenceStack) {
  if (schema === true) return;
  if (schema === false) {
    addError(errors, path, 'boolean schema rejects every value');
    return;
  }
  if (schema.$ref) {
    const key = `${schema.$ref}\u0000${path}`;
    if (referenceStack.has(key)) throw new SchemaDefinitionError(`cyclic schema reference at ${schema.$ref}`);
    referenceStack.add(key);
    validateNode(value, resolveReference(rootSchema, schema.$ref), rootSchema, path, errors, referenceStack);
    referenceStack.delete(key);
  }

  if (schema.const !== undefined && !equalJson(value, schema.const)) addError(errors, path, 'must equal const value');
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
      throw new SchemaDefinitionError('enum must be a non-empty array');
    }
    if (!schema.enum.some((candidate) => equalJson(value, candidate))) addError(errors, path, 'must equal one of enum values');
  }

  for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
    if (!schema[keyword]) continue;
    const branches = schema[keyword].map((branch) => {
      const branchErrors = [];
      validateNode(value, branch, rootSchema, path, branchErrors, new Set(referenceStack));
      return branchErrors;
    });
    const matches = branches.filter((branchErrors) => branchErrors.length === 0).length;
    if (keyword === 'allOf' && matches !== branches.length) addError(errors, path, 'must satisfy every allOf branch');
    if (keyword === 'anyOf' && matches === 0) addError(errors, path, 'must satisfy at least one anyOf branch');
    if (keyword === 'oneOf' && matches !== 1) addError(errors, path, 'must satisfy exactly one oneOf branch');
  }
  if (schema.not) {
    const branchErrors = [];
    validateNode(value, schema.not, rootSchema, path, branchErrors, new Set(referenceStack));
    if (branchErrors.length === 0) addError(errors, path, 'must not satisfy the not schema');
  }

  const expectedTypes = schema.type === undefined ? null : (Array.isArray(schema.type) ? schema.type : [schema.type]);
  if (expectedTypes && !expectedTypes.some((type) => matchesType(value, type))) {
    addError(errors, path, `must have type ${expectedTypes.join(' or ')}`);
    return;
  }

  if (isPlainObject(value)) {
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) addError(errors, `${path}.${required}`, 'is required');
    }
    const properties = schema.properties ?? {};
    for (const [key, child] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) validateNode(value[key], child, rootSchema, `${path}.${key}`, errors, referenceStack);
    }
    for (const key of Object.keys(value)) {
      if (Object.hasOwn(properties, key)) continue;
      if (schema.additionalProperties === false) addError(errors, `${path}.${key}`, 'additional property is not allowed');
      else if (isPlainObject(schema.additionalProperties) || typeof schema.additionalProperties === 'boolean') {
        validateNode(value[key], schema.additionalProperties, rootSchema, `${path}.${key}`, errors, referenceStack);
      }
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) addError(errors, path, `must contain at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) addError(errors, path, `must contain at most ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value.map((entry) => canonicalJson(entry))).size !== value.length) {
      addError(errors, path, 'must contain unique items');
    }
    if (schema.items !== undefined) {
      value.forEach((entry, index) => validateNode(entry, schema.items, rootSchema, `${path}[${index}]`, errors, referenceStack));
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) addError(errors, path, `must contain at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) addError(errors, path, `must contain at most ${schema.maxLength} characters`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) addError(errors, path, `must match ${schema.pattern}`);
    if (schema.format === 'date-time' && !validateDateTime(value)) addError(errors, path, 'must be an RFC 3339 date-time');
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) addError(errors, path, `must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) addError(errors, path, `must be <= ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) addError(errors, path, `must be > ${schema.exclusiveMinimum}`);
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) addError(errors, path, `must be < ${schema.exclusiveMaximum}`);
  }
}

export function validateSchema(value, schema) {
  inspectSchema(schema, '#', new Set());
  const errors = [];
  validateNode(value, schema, schema, '$', errors, new Set());
  return { valid: errors.length === 0, errors };
}

export function assertValidSchema(value, schema, label) {
  const result = validateSchema(value, schema);
  if (!result.valid) throw new SchemaValidationError(result.errors, label);
  return value;
}

export async function loadJsonSchema(path) {
  let source;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    throw new SchemaDefinitionError(`${path}: cannot read schema: ${error.message}`);
  }
  let schema;
  try {
    schema = JSON.parse(source);
  } catch (error) {
    throw new SchemaDefinitionError(`${path}: invalid JSON: ${error.message}`);
  }
  inspectSchema(schema, '#', new Set());
  return schema;
}
