import { search } from './search.mjs';
import { optimizeTour, simulate, repeatTour } from './trade.mjs';
let generation = 0;
self.onmessage = async ({ data }) => {
  const token = ++generation;
  if (data.type === 'cancel') return;
  try {
    if (data.type === 'detail') {
      const quote = data.route.itemQuantities ? simulate(data.route.legs, data.route.itemQuantities, data.dataset.bases, data.options, data.route.orderMask) :
        optimizeTour(data.route.legs, data.dataset.bases, data.options);
      const repeats = quote && data.route.closed ? repeatTour(data.route.legs, quote, data.options) : null;
      self.postMessage({ type: 'detail', id: data.id, quote, repeats });
    } else {
      const result = await search(data.dataset, data.navigation, data.profile, data.options,
        progress => { if (token === generation) self.postMessage({ type: 'progress', id: data.id, ...progress }); }, () => token !== generation);
      if (token === generation) self.postMessage({ type: 'result', id: data.id, result });
    }
  } catch (error) { self.postMessage({ type: 'error', id: data.id, message: error.message }); }
};
