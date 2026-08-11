import { TtsConfig } from '../types'

// GPT-SoVITS 朗读。
// api_v2.py: POST {base}/tts，JSON body，字段 text/text_lang/ref_audio_path/prompt_lang/
//            prompt_text/text_split_method/media_type/speed_factor/streaming_mode
// api.py(旧): POST {base}/，JSON body，字段 text/text_language/refer_wav_path/prompt_language/cut_punc
// 两者都是 JSON body（FastAPI 用 pydantic model / request.json()），用 query string 会 422。
// 返回音频 objectURL（wav），供 <audio> 播放。

/** 前置校验：必填字段为空时直接抛出明确错误，避免无意义的 400 请求 */
function validateTtsPayload(text: string, cfg: TtsConfig): void {
  if (!text.trim()) throw new Error('TTS: 待朗读文本为空')
  if (!cfg.baseUrl?.trim()) throw new Error('TTS: 未配置服务地址 (baseUrl)')
  if (cfg.apiVersion === 'v2') {
    if (!cfg.refAudioPath?.trim()) throw new Error('TTS: 未配置参考音频路径 (refAudioPath)，请在设置中填写参考音频文件的完整路径')
    if (!cfg.textLang?.trim()) throw new Error('TTS: 未配置文本语言 (textLang)')
    if (!cfg.promptLang?.trim()) throw new Error('TTS: 未配置提示词语言 (promptLang)')
  } else {
    if (!cfg.refAudioPath?.trim()) throw new Error('TTS: 未配置参考音频路径 (refer_wav_path)')
    if (!cfg.textLang?.trim()) throw new Error('TTS: 未配置文本语言 (text_language)')
    if (!cfg.promptLang?.trim()) throw new Error('TTS: 未配置提示词语言 (prompt_language)')
  }
}

export async function speak(text: string, cfg: TtsConfig): Promise<string> {
  // 前置校验——把"必填为空"这类用户侧配置问题提前拦截，附带中文指引
  validateTtsPayload(text, cfg)

  const base = cfg.baseUrl.replace(/\/+$/, '')

  const url = cfg.apiVersion === 'v2' ? `${base}/tts` : `${base}/`
  const payload: Record<string, unknown> =
    cfg.apiVersion === 'v2'
      ? {
          text,
          text_lang: cfg.textLang,
          ref_audio_path: cfg.refAudioPath,
          prompt_lang: cfg.promptLang,
          prompt_text: cfg.promptText || '',
          text_split_method: 'cut5',
          media_type: 'wav',
          streaming_mode: false,
          parallel_infer: true,
          batch_size: 1,
          speed_factor: cfg.speed
        }
      : {
          text,
          text_language: cfg.textLang,
          refer_wav_path: cfg.refAudioPath,
          prompt_language: cfg.promptLang,
          prompt_text: cfg.promptText || '',
          cut_punc: '，。！？',
          speed: cfg.speed
        }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.text()
      // 尝试解析 GPT-SoVITS 返回的 JSON 错误体 {"message":"...","exception":"..."}
      try {
        const j = JSON.parse(body)
        detail = j.message || j.detail || j.exception || body
      } catch {
        detail = body.slice(0, 300)
      }
    } catch { /* ignore */ }
    // 给出中文可读的错误信息，包含常见原因提示
    const hint = res.status === 400
      ? '\n\n常见原因：参考音频文件不存在/格式不支持、文本语言代码不正确、或参考音频超过10秒。请检查设置中的 TTS 配置。'
      : ''
    throw new Error(`TTS 请求失败 (${res.status})${detail ? ': ' + detail : ''}${hint}`)
  }

  const blob = await res.blob()
  return URL.createObjectURL(blob)
}
