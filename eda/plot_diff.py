import pandas as pd
import glob
import os
import matplotlib.pyplot as plt

os.chdir('/Users/raghav/Downloads/Prosperity_2026/eda')

# Use sorted() to ensure day_0, day_1, day_2 order before concat
price_files = sorted(glob.glob('prices_round_3_day_*.csv'))
# Simple concatenation, no joins!
prices_df = pd.concat([pd.read_csv(f, sep=';') for f in price_files], ignore_index=True)

# Even though concatenated in order, a quick sort guarantees chronological integrity for .diff()
prices_df.sort_values(by=['day', 'timestamp'], inplace=True)

products = ['HYDROGEL_PACK', 'VELVETFRUIT_EXTRACT']

for product in products:
    # Filter for the specific product
    prod_df = prices_df[prices_df['product'] == product].copy()
    
    # Calculate difference between consecutive timestamps (prices)
    prod_df['price_diff'] = prod_df['mid_price'].diff()
    
    plt.figure(figsize=(15, 6))
    # Plot the differences
    plt.plot(range(len(prod_df)), prod_df['price_diff'], label=f'{product} Diff', linewidth=1)
    plt.title(f'Mid Price Difference Between Consecutive Timestamps: {product}', fontsize=14)
    plt.xlabel('Time (Consecutive Ticks across 3 Days)', fontsize=12)
    plt.ylabel('Price Difference', fontsize=12)
    plt.grid(True, alpha=0.3)
    plt.legend()
    
    # Save directly to artifacts
    plt.savefig(f'/Users/raghav/.gemini/antigravity/brain/bd66ce9f-eb4d-46f3-b8f8-0e2c633eccd6/artifacts/{product.lower()}_diff.png', bbox_inches='tight')
    plt.close()

print("Diff plots generated.")
