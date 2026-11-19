(function (root, factory) {
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.CoreValues = catalog;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  return {
    filipino: { label: 'Filipino Core Values', items: [
      ['faith', 'Maka-Diyos', 'Expresses one’s spiritual beliefs while respecting the spiritual beliefs of others'],
      ['truth', 'Maka-Diyos', 'Shows adherence to ethical principles by upholding the truth in all undertakings'],
      ['respect', 'Makatao', 'Is sensitive to individual, social and cultural differences; resists stereotyping people'],
      ['solidarity', 'Makatao', 'Demonstrates contributions toward solidarity'],
      ['environment', 'Makakalikasan', 'Cares for the environment and utilizes resources wisely, judiciously and economically'],
      ['citizenship', 'Makabansa', 'Demonstrates pride in being a Filipino; exercises the rights and responsibilities of a Filipino citizen'],
      ['participation', 'Makabansa', 'Demonstrates appropriate behavior in carrying out activities in the school, community and country']
    ] },
    personal: { label: 'His/Her Core Values', items: [
      ['biblical', 'Biblical Truth and Worldview', 'Holding to one’s faith while respecting others’ beliefs'],
      ['unity', 'Unity', 'Promotes harmony amidst differences to achieve common goals'],
      ['integrity', 'Integrity', 'Doing the right things even if no one is looking'],
      ['loyalty', 'Loyalty', 'Staying true and committed to what is promised or expected to deliver'],
      ['dependence', 'Dependence in God', 'Trusting the Lord in all aspects of life'],
      ['excellence', 'Excellence', 'Giving all the effort to improve oneself and be better each day'],
      ['responsibility', 'Responsibility', 'Taking full accountability for the consequence brought by one’s decision'],
      ['stewardship', 'Stewardship', 'Exhibits careful and responsible management of resources']
    ] }
  };
});
