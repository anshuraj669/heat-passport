// Heat illness triage and first aid, following OSHA and CDC guidance.
// https://www.osha.gov/heat-exposure/illness-first-aid

export const SYMPTOMS = {
  confusion: 'emergency', fainting: 'emergency', hotDrySkin: 'emergency', seizure: 'emergency',
  headache: 'exhaustion', dizziness: 'exhaustion', nausea: 'exhaustion', heavySweating: 'exhaustion',
  cramps: 'exhaustion', weakness: 'exhaustion', thirst: 'exhaustion',
};

export function triage(symptoms) {
  if (symptoms.some((s) => SYMPTOMS[s] === 'emergency')) return 'emergency';
  if (symptoms.length) return 'exhaustion';
  return 'reported';
}

const STEPS = {
  en: {
    emergency: {
      title: 'Possible HEAT STROKE: this is a medical emergency',
      steps: ['Call 911 now', 'Move the person to shade or a cool place', 'Cool them fast: soak clothes with cold water, fan them, put ice or cold packs on neck, armpits and groin', 'Do not give drinks if they are confused or not fully awake', 'Stay with them until help arrives'],
    },
    exhaustion: {
      title: 'Possible heat exhaustion: stop work now',
      steps: ['Stop working and move to shade or air conditioning', 'Loosen or remove extra clothing', 'Cool down with wet cloths and a fan', 'Sip cool water', 'Do not stay alone: your supervisor has been alerted', 'Get medical care if you vomit, feel worse, or are not better within 1 hour'],
    },
    reported: {
      title: 'Feeling unwell in the heat: stop work now',
      steps: ['Stop working and move to shade', 'Sip cool water and cool down with wet cloths', 'Your supervisor has been alerted', 'If you feel confused, faint, or stop sweating: call 911'],
    },
  },
  es: {
    emergency: {
      title: 'Posible GOLPE DE CALOR: es una emergencia médica',
      steps: ['Llame al 911 ahora', 'Lleve a la persona a la sombra o a un lugar fresco', 'Enfríela rápido: moje la ropa con agua fría, échele aire, ponga hielo o compresas frías en cuello, axilas e ingle', 'No le dé de beber si está confundida o no está bien despierta', 'Quédese con ella hasta que llegue la ayuda'],
    },
    exhaustion: {
      title: 'Posible agotamiento por calor: deje de trabajar ahora',
      steps: ['Deje de trabajar y vaya a la sombra o al aire acondicionado', 'Afloje o quítese la ropa extra', 'Refrésquese con paños mojados y aire', 'Tome agua fresca a sorbos', 'No se quede solo: su supervisor ya fue avisado', 'Busque atención médica si vomita, se siente peor o no mejora en 1 hora'],
    },
    reported: {
      title: 'Se siente mal en el calor: deje de trabajar ahora',
      steps: ['Deje de trabajar y vaya a la sombra', 'Tome agua fresca a sorbos y refrésquese con paños mojados', 'Su supervisor ya fue avisado', 'Si se siente confundido, se desmaya o deja de sudar: llame al 911'],
    },
  },
  pt: {
    emergency: {
      title: 'Possível INSOLAÇÃO GRAVE: é uma emergência médica',
      steps: ['Ligue para o 911 agora', 'Leve a pessoa para a sombra ou um lugar fresco', 'Resfrie rápido: molhe as roupas com água fria, abane e coloque gelo ou compressas frias no pescoço, axilas e virilha', 'Não dê líquidos se a pessoa estiver confusa ou sonolenta', 'Fique com ela até a ajuda chegar'],
    },
    exhaustion: {
      title: 'Possível exaustão pelo calor: pare de trabalhar agora',
      steps: ['Pare de trabalhar e vá para a sombra ou o ar-condicionado', 'Afrouxe ou tire o excesso de roupa', 'Refresque-se com panos molhados e vento', 'Beba água fresca aos poucos', 'Não fique sozinho: seu supervisor foi avisado', 'Procure atendimento médico se vomitar, piorar ou não melhorar em 1 hora'],
    },
    reported: {
      title: 'Mal-estar no calor: pare de trabalhar agora',
      steps: ['Pare de trabalhar e vá para a sombra', 'Beba água fresca aos poucos e refresque-se com panos molhados', 'Seu supervisor foi avisado', 'Se ficar confuso, desmaiar ou parar de suar: ligue para o 911'],
    },
  },
};

const NO_SUPERVISOR = {
  en: 'No supervisor is connected to your passport: tell someone near you right now',
  es: 'Ningún supervisor está conectado a su pasaporte: avísele ahora a alguien cerca',
  pt: 'Nenhum supervisor está conectado ao seu passaporte: avise agora alguém por perto',
};

// Steps are written with 911; every message swaps in the local emergency number.
export const withNumber = (text, number = '911') => text.replaceAll('911', number);

// Never tell someone help is coming when no one was told.
export function firstAid(severity, lang = 'en', { supervisorAlerted = true, emergencyNumber = '911' } = {}) {
  const language = STEPS[lang] ? lang : 'en';
  const aid = STEPS[language][severity] ?? STEPS[language].reported;
  const steps = supervisorAlerted ? aid.steps : [NO_SUPERVISOR[language], ...aid.steps.filter((s) => !/supervisor/i.test(s))];
  return { title: aid.title, steps: steps.map((s) => withNumber(s, emergencyNumber)), emergencyNumber };
}
