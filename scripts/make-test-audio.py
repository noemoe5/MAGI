"""生成测试用 WAV：两「张」专辑、五首曲目，时长各不相同，便于验证表格/排序/播放。"""
import math
import os
import struct
import wave

ROOT = r'D:\MAGI测试音乐'
SPECS = [
    ('Album A', '01 - 夜行.wav', 3.0, 440),
    ('Album A', '02 - 潮汐.wav', 2.0, 523),
    ('Album A', '03 - 归途.wav', 4.0, 349),
    ('Album B', '01 - 灯火.wav', 2.5, 587),
    ('Album B', '02 - 长夜.wav', 1.5, 659),
]

SR = 22050


def make(path, seconds, freq):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    n = int(SR * seconds)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()
        for i in range(n):
            # 加一点衰减包络，听起来像拨弦，避免纯方波刺耳
            env = math.exp(-2.2 * i / n)
            v = int(12000 * env * math.sin(2 * math.pi * freq * i / SR))
            frames += struct.pack('<h', v)
        w.writeframes(bytes(frames))


for album, name, sec, freq in SPECS:
    p = os.path.join(ROOT, album, name)
    make(p, sec, freq)
    print(f'{p}  {os.path.getsize(p)} bytes')

print('OK')
