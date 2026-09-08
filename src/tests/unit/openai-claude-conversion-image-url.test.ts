import { describe, expect, it } from 'vitest';

import { convertOpenAIPartsToAnthropicContent } from '@/modules/proxy-gateway/server/modules/openai/chat/openai-claude-conversion';
import type { OpenAIContentPart } from '@/modules/proxy-gateway/server/common/interfaces/request-interfaces';

describe('OpenAI image URL conversion', () => {
  const imageUrls: ReadonlyArray<NonNullable<OpenAIContentPart['image_url']>> = [
    'data:image/png;base64,AA==',
    { url: 'data:image/png;base64,AA==', detail: 'high' },
  ];

  it.each(imageUrls)(
    'converts supported image URL form %# into an Anthropic image block',
    (imageUrl) => {
      const content = convertOpenAIPartsToAnthropicContent([
        {
          type: 'image_url',
          image_url: imageUrl,
        },
      ]);

      expect(content).toEqual([
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'AA==',
          },
        },
      ]);
    },
  );
});
