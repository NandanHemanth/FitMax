/** Quick reads: peer-reviewed findings FitMax builds on, each with a one-line takeaway. */
export interface Paper {
  id: string;
  title: string;
  takeaway: string;
  source: string;
  url: string;
  tags: string[];
}

export const PAPERS: Paper[] = [
  {
    id: 'volume',
    title: 'More weekly sets, more muscle',
    takeaway: 'Each extra weekly set per muscle added about 0.37% growth; 10+ sets a week beat fewer than 5.',
    source: 'Schoenfeld, Ogborn & Krieger · J Sports Sci 2017 · meta-analysis',
    url: 'https://doi.org/10.1080/02640414.2016.1210197',
    tags: ['build_muscle', 'hypertrophy'],
  },
  {
    id: 'protein',
    title: 'How much protein actually helps',
    takeaway: 'Gains from protein plateau around 1.6 g per kg of body weight a day; up to 2.2 g/kg may help some.',
    source: 'Morton et al. · Br J Sports Med 2018 · meta-analysis of 49 trials',
    url: 'https://doi.org/10.1136/bjsports-2017-097608',
    tags: ['build_muscle', 'hypertrophy', 'shred'],
  },
  {
    id: 'habit',
    title: 'Habits take about two months',
    takeaway: 'Automaticity took a median of 66 days (range 18 to 254). Missing one day did not derail it.',
    source: 'Lally et al. · Eur J Soc Psychol 2010',
    url: 'https://doi.org/10.1002/ejsp.674',
    tags: ['general', 'all'],
  },
  {
    id: 'who',
    title: 'The minimum that protects your health',
    takeaway: 'Adults: 150 to 300 min of moderate activity a week plus muscle-strengthening on 2 or more days.',
    source: 'WHO guidelines on physical activity and sedentary behaviour · 2020',
    url: 'https://www.who.int/publications/i/item/9789240015128',
    tags: ['general', 'endurance', 'all'],
  },
  {
    id: 'strength-mortality',
    title: 'Strength training and a longer life',
    takeaway: '30 to 60 min of muscle-strengthening a week was linked to 10 to 20% lower risk of death, heart disease and cancer.',
    source: 'Momma et al. · Br J Sports Med 2022 · meta-analysis',
    url: 'https://doi.org/10.1136/bjsports-2021-105061',
    tags: ['general', 'all'],
  },
  {
    id: 'built-env',
    title: 'Where you live changes how much you move',
    takeaway: 'Walkability, parks, recreation access and nearby destinations are the strongest built-environment links to activity.',
    source: 'Barnett et al. · Int J Behav Nutr Phys Act 2017 · meta-analysis',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5547528',
    tags: ['all', 'places'],
  },
];

export interface Video {
  title: string;
  by: string;
  minutes: string;
  url: string;
}

/** Links out (search links where a direct link could change). */
export const VIDEOS: Video[] = [
  {
    title: 'Biceps curl with dumbbell',
    by: 'Mayo Clinic, Dr. Edward Laskowski',
    minutes: '1 min',
    url: 'https://middlesexhealth.org/learning-center/videos/video-biceps-curl-with-dumbbell',
  },
  {
    title: 'How to build huge biceps: optimal training explained',
    by: 'Jeff Nippard',
    minutes: '10 min',
    url: 'https://www.youtube.com/results?search_query=Jeff+Nippard+How+To+Build+Huge+Biceps+Optimal+Training+Explained',
  },
  {
    title: '5 common biceps curl mistakes and fixes',
    by: 'Jeremy Ethier',
    minutes: '8 min',
    url: 'https://www.youtube.com/results?search_query=Jeremy+Ethier+biceps+curl+mistakes',
  },
];
