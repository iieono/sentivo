import React from 'react';
import { Text as RNText, TextInput as RNTextInput } from 'react-native';

// Map fontWeight -> the matching Chillax file. RN doesn't synthesize weights for
// custom fonts, so we translate the weight the components already set into the
// right family. This applies Chillax everywhere with zero per-component edits.
const FAMILY: Record<string, string> = {
  '100': 'Chillax-Extralight',
  '200': 'Chillax-Extralight',
  '300': 'Chillax-Light',
  '400': 'Chillax-Regular',
  normal: 'Chillax-Regular',
  '500': 'Chillax-Medium',
  '600': 'Chillax-Semibold',
  '700': 'Chillax-Bold',
  '800': 'Chillax-Bold',
  '900': 'Chillax-Bold',
  bold: 'Chillax-Bold',
};

function familyFor(style: any): string {
  let weight = '400';
  const walk = (s: any) => {
    if (!s) return;
    if (Array.isArray(s)) {
      s.forEach(walk);
      return;
    }
    if (typeof s === 'object' && s.fontWeight != null) weight = String(s.fontWeight);
  };
  walk(style);
  return FAMILY[weight] || 'Chillax-Regular';
}

function patch(Comp: any) {
  if (!Comp || typeof Comp.render !== 'function') return;
  const orig = Comp.render;
  Comp.render = function (props: any, ref: any) {
    const el = orig.call(this, props, ref);
    if (!el) return el;
    return React.cloneElement(el, {
      style: [{ fontFamily: familyFor(props?.style) }, el.props?.style],
    });
  };
}

patch(RNText);
patch(RNTextInput);
