import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type {
  OpenAIChatRequest,
  OpenAIResponseFormat,
} from '../../../common/interfaces/request-interfaces';

const JsonSchemaObjectSchema = z.record(z.string(), z.unknown());
const OpenAIJsonSchemaEnvelopeSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  schema: JsonSchemaObjectSchema,
  strict: z.boolean().optional(),
});
const OpenAIChatJsonSchemaResponseFormatSchema = z.object({
  type: z.literal('json_schema'),
  json_schema: OpenAIJsonSchemaEnvelopeSchema,
});
const ResponsesTextFormatTypeSchema = z.object({
  type: z.string(),
});
const ResponsesJsonSchemaFormatSchema = z.object({
  type: z.literal('json_schema'),
  name: z.string().optional(),
  description: z.string().optional(),
  schema: JsonSchemaObjectSchema,
  strict: z.boolean().optional(),
});

export function validateOpenAIResponseFormat(request: OpenAIChatRequest): void {
  const responseFormat = request.response_format;
  if (!responseFormat || responseFormat.type !== 'json_schema') {
    return;
  }

  const parsed = OpenAIChatJsonSchemaResponseFormatSchema.safeParse(responseFormat);
  if (!parsed.success) {
    throw new BadRequestException(
      'Invalid response_format: json_schema must include an object schema and typed optional fields',
    );
  }
}

export function toResponsesOpenAIResponseFormat(value: unknown): OpenAIResponseFormat | undefined {
  const formatType = ResponsesTextFormatTypeSchema.safeParse(value);
  if (!formatType.success) {
    return undefined;
  }

  if (formatType.data.type !== 'json_schema') {
    return { type: formatType.data.type };
  }

  const jsonSchemaFormat = ResponsesJsonSchemaFormatSchema.safeParse(value);
  if (!jsonSchemaFormat.success) {
    throw new BadRequestException(
      'Invalid response_format: json_schema must include an object schema and typed optional fields',
    );
  }

  const { data } = jsonSchemaFormat;
  return {
    type: 'json_schema',
    json_schema: {
      name: data.name,
      description: data.description,
      schema: data.schema,
      strict: data.strict,
    },
  };
}
