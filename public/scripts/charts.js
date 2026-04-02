const chartRegistry = {
  cashflow: null,
  asset: null,
  sector: null,
  yield: null
};

const textColor = "#d8ebf5";
const gridColor = "rgba(137, 167, 189, 0.2)";

function buildBaseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: textColor
        }
      }
    },
    scales: {
      x: {
        ticks: { color: textColor },
        grid: { color: gridColor }
      },
      y: {
        ticks: { color: textColor },
        grid: { color: gridColor }
      }
    }
  };
}

function candleAsBars(ctx, dataPoints) {
  const labels = dataPoints.map((_, idx) => `D${idx + 1}`);
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Daily Yield %",
          data: dataPoints,
          borderWidth: 1,
          backgroundColor: dataPoints.map((v) => (v >= 0 ? "rgba(0, 247, 255, 0.5)" : "rgba(240, 106, 119, 0.5)")),
          borderColor: dataPoints.map((v) => (v >= 0 ? "rgba(0, 247, 255, 0.8)" : "rgba(240, 106, 119, 0.9)"))
        }
      ]
    },
    options: {
      ...buildBaseOptions(),
      plugins: {
        legend: {
          labels: { color: textColor }
        },
        tooltip: {
          callbacks: {
            label(context) {
              return `Yield ${context.raw.toFixed(2)}%`;
            }
          }
        }
      }
    }
  });
}

export function renderFinanceCharts(finances) {
  if (typeof Chart === "undefined") {
    return;
  }

  const cashflowCanvas = document.getElementById("cashflow-chart");
  const assetCanvas = document.getElementById("asset-chart");
  const sectorCanvas = document.getElementById("sector-chart");
  const yieldCanvas = document.getElementById("yield-chart");

  const labels = Array.from({ length: 30 }, (_, idx) => `D${idx + 1}`);
  const flowBase = finances.dailyRevenue - finances.dailyCosts;
  const cashProjection = labels.map((_, idx) => flowBase + Math.round(Math.sin(idx / 3) * 9000));

  if (!chartRegistry.cashflow) {
    chartRegistry.cashflow = new Chart(cashflowCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Net Daily Flow",
            data: cashProjection,
            fill: true,
            borderColor: "rgba(0, 247, 255, 0.9)",
            backgroundColor: "rgba(0, 247, 255, 0.12)",
            tension: 0.35
          }
        ]
      },
      options: buildBaseOptions()
    });
  } else {
    chartRegistry.cashflow.data.labels = labels;
    chartRegistry.cashflow.data.datasets[0].data = cashProjection;
    chartRegistry.cashflow.update("none");
  }

  if (!chartRegistry.asset) {
    chartRegistry.asset = new Chart(assetCanvas, {
      type: "bar",
      data: {
        labels: ["Assets", "Liabilities", "Liquid Credits"],
        datasets: [
          {
            label: "Credits",
            data: [finances.assets, finances.liabilities, finances.credits],
            backgroundColor: ["rgba(0, 247, 255, 0.45)", "rgba(255, 170, 51, 0.45)", "rgba(216, 235, 245, 0.45)"],
            borderColor: ["rgba(0, 247, 255, 0.95)", "rgba(255, 170, 51, 0.95)", "rgba(216, 235, 245, 0.95)"],
            borderWidth: 1
          }
        ]
      },
      options: buildBaseOptions()
    });
  } else {
    chartRegistry.asset.data.datasets[0].data = [finances.assets, finances.liabilities, finances.credits];
    chartRegistry.asset.update("none");
  }

  if (!chartRegistry.sector) {
    chartRegistry.sector = new Chart(sectorCanvas, {
      type: "pie",
      data: {
        labels: ["Mining", "Refining", "Trade", "Security", "Research"],
        datasets: [
          {
            data: [36, 24, 19, 11, 10],
            backgroundColor: [
              "rgba(0, 247, 255, 0.7)",
              "rgba(255, 170, 51, 0.7)",
              "rgba(137, 167, 189, 0.8)",
              "rgba(100, 160, 255, 0.7)",
              "rgba(179, 225, 245, 0.7)"
            ],
            borderColor: "rgba(5, 5, 15, 1)",
            borderWidth: 1
          }
        ]
      },
      options: {
        plugins: {
          legend: {
            labels: { color: textColor }
          }
        }
      }
    });
  } else {
    chartRegistry.sector.update("none");
  }

  const yieldSeries = Array.from({ length: 14 }, (_, idx) => finances.bondYieldPct + Math.sin(idx / 2.2) * 1.2 - 0.45);
  if (!chartRegistry.yield) {
    chartRegistry.yield = candleAsBars(yieldCanvas, yieldSeries);
  } else {
    chartRegistry.yield.data.labels = yieldSeries.map((_, idx) => `D${idx + 1}`);
    chartRegistry.yield.data.datasets[0].data = yieldSeries;
    chartRegistry.yield.data.datasets[0].backgroundColor = yieldSeries.map((v) =>
      v >= 0 ? "rgba(0, 247, 255, 0.5)" : "rgba(240, 106, 119, 0.5)"
    );
    chartRegistry.yield.data.datasets[0].borderColor = yieldSeries.map((v) =>
      v >= 0 ? "rgba(0, 247, 255, 0.8)" : "rgba(240, 106, 119, 0.9)"
    );
    chartRegistry.yield.update("none");
  }
}
