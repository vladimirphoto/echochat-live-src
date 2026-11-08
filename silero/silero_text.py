# -*- coding: utf-8 -*-
"""Подготовка текста из чата для Silero: числа и латиница -> кириллица, лишние символы убираются.

Модель знает только кириллицу и несколько знаков препинания; всё остальное она молча выбрасывает
(цифры «2026» просто пропали бы из фразы), поэтому текст приводим к чистому русскому заранее.
Только стандартная библиотека: модуль работает и тестируется без PyTorch.
"""
import re

_ONES_M = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять',
           'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать',
           'семнадцать', 'восемнадцать', 'девятнадцать']
_ONES_F = ['ноль', 'одна', 'две'] + _ONES_M[3:]
_TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто']
_HUND = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот']
# (одна форма, две-четыре, пять и больше, женский род)
_SCALES = [
    None,
    ('тысяча', 'тысячи', 'тысяч', True),
    ('миллион', 'миллиона', 'миллионов', False),
    ('миллиард', 'миллиарда', 'миллиардов', False),
]


def _plural(n, forms):
    if 11 <= n % 100 <= 14:
        return forms[2]
    if n % 10 == 1:
        return forms[0]
    if 2 <= n % 10 <= 4:
        return forms[1]
    return forms[2]


def _triplet(n, fem):
    words = []
    if n >= 100:
        words.append(_HUND[n // 100])
        n %= 100
    if n >= 20:
        words.append(_TENS[n // 10])
        n %= 10
    if n > 0:
        words.append((_ONES_F if fem else _ONES_M)[n])
    return words


def digits_words(s):
    return ' '.join(_ONES_M[int(c)] for c in s if c.isdigit())


def int_words(n):
    """Целое число прописью. Очень большие числа читаются по цифрам."""
    if n < 0:
        return 'минус ' + int_words(-n)
    if n == 0:
        return 'ноль'
    if n >= 10 ** 12:
        return digits_words(str(n))
    groups = []
    while n:
        groups.append(n % 1000)
        n //= 1000
    out = []
    for i in range(len(groups) - 1, -1, -1):
        g = groups[i]
        if not g:
            continue
        scale = _SCALES[i]
        out.extend(_triplet(g, bool(scale and scale[3])))
        if scale:
            out.append(_plural(g, scale))
    return ' '.join(out)


# Латиница читается по-русски «на слух»; сначала сочетания букв, потом одиночные
_LAT_MULTI = [('sch', 'ск'), ('sh', 'ш'), ('ch', 'ч'), ('zh', 'ж'), ('ph', 'ф'), ('ck', 'к'), ('th', 'з'),
              ('oo', 'у'), ('ee', 'и'), ('qu', 'кв')]
_LAT = {'a': 'а', 'b': 'б', 'c': 'к', 'd': 'д', 'e': 'е', 'f': 'ф', 'g': 'г', 'h': 'х', 'i': 'и', 'j': 'дж',
        'k': 'к', 'l': 'л', 'm': 'м', 'n': 'н', 'o': 'о', 'p': 'п', 'q': 'к', 'r': 'р', 's': 'с', 't': 'т',
        'u': 'у', 'v': 'в', 'w': 'в', 'x': 'кс', 'y': 'й', 'z': 'з'}


def translit(word):
    w = word.lower()
    for a, b in _LAT_MULTI:
        w = w.replace(a, b)
    return ''.join(_LAT.get(ch, ch) for ch in w)


_DEC = re.compile(r'(\d+)[.,](\d+)')
_NUM = re.compile(r'\d+')
_LATIN = re.compile(r'[A-Za-z]+')
_KEEP = re.compile(r'[^а-яё,.!?;:\-\s]')


def prepare(text):
    """Возвращает текст, пригодный для модели, или пустую строку, если читать нечего."""
    t = str(text)
    t = t.replace('+', ' плюс ').replace('%', ' процентов ').replace('&', ' и ').replace('=', ' равно ')
    t = _DEC.sub(lambda m: ' %s запятая %s ' % (int_words(int(m.group(1))), int_words(int(m.group(2)))), t)
    t = _NUM.sub(lambda m: ' ' + int_words(int(m.group(0))) + ' ', t)
    t = _LATIN.sub(lambda m: ' ' + translit(m.group(0)) + ' ', t)
    t = t.lower().replace('…', '.').replace('—', '-').replace('–', '-')
    t = _KEEP.sub(' ', t)
    if not re.search(r'[а-яё]', t):
        return ''
    t = re.sub(r'([,.!?;:\-])\1+', r'\1', t)
    t = re.sub(r'\s+([,.!?;:])', r'\1', t)
    t = re.sub(r'\s+', ' ', t).strip()
    t = re.sub(r'^[,.!?;:\-\s]+', '', t)
    if t and t[-1] not in '.!?':
        t = t.rstrip(',;:-') + '.'
    return t
